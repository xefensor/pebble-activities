#include <pebble.h>
#include <pebble-activities/pebble-activities.h>
#include <string.h>

#include "timer_model.h"

#define MODEL_KEY 2100
#define WAKEUP_KEY 2101
#define PUBLICATION_KEY 2102
#define RETRY_LIMIT 3

#if defined(ACTIVITY_TIMER_DIAGNOSTICS) && ACTIVITY_TIMER_DIAGNOSTICS
#define TIMER_DIAG(...) APP_LOG(APP_LOG_LEVEL_INFO, __VA_ARGS__)
#else
#define TIMER_DIAG(...) ((void)0)
#endif

static Window *s_window;
static TextLayer *s_title, *s_time, *s_state_label, *s_sharing, *s_controls;
static ActivityTimerModel s_timer;
static PaPublisher s_publisher;
static WakeupId s_wakeup = -1;
static AppTimer *s_retry_timer;
static bool s_phone_ready, s_storage_error, s_alarm_error, s_share_error;
static unsigned s_retries;
static uint32_t s_transport_ticket;
static char s_time_text[24], s_run_id[32];

static void prv_flush(void);
static void prv_refresh(void);

static uint32_t prv_now(void) { return (uint32_t)time(NULL); }

static bool prv_u32(const Tuple *tuple, uint32_t *value) {
  if (!tuple || !value || (tuple->type != TUPLE_UINT && tuple->type != TUPLE_INT)) return false;
  if (tuple->type == TUPLE_UINT) {
    if (tuple->length == 1) *value = tuple->value->uint8;
    else if (tuple->length == 2) *value = tuple->value->uint16;
    else if (tuple->length == 4) *value = tuple->value->uint32;
    else return false;
  } else {
    int32_t signed_value;
    if (tuple->length == 1) signed_value = tuple->value->int8;
    else if (tuple->length == 2) signed_value = tuple->value->int16;
    else if (tuple->length == 4) signed_value = tuple->value->int32;
    else return false;
    if (signed_value < 0) return false;
    *value = (uint32_t)signed_value;
  }
  return true;
}

static const char *prv_string(const Tuple *tuple) {
  if (!tuple || tuple->type != TUPLE_CSTRING || !tuple->length || tuple->length > PA_ID_BYTES + 1)
    return NULL;
  const char *value = tuple->value->cstring;
  return memchr(value, '\0', tuple->length) == value + tuple->length - 1 ? value : NULL;
}

static void prv_identity(void) {
  snprintf(s_run_id, sizeof(s_run_id), "%08lx:%08lx", (unsigned long)s_timer.origin,
      (unsigned long)s_timer.run);
}

static bool prv_save(const ActivityTimerModel *timer) {
  s_storage_error = persist_write_data(MODEL_KEY, timer, sizeof(*timer)) != (int)sizeof(*timer);
  return !s_storage_error;
}

static void prv_schedule_alarm(void) {
  wakeup_cancel_all();
  s_wakeup = -1;
  s_alarm_error = false;
  if (s_timer.state == ACTIVITY_TIMER_RUNNING && s_timer.deadline > prv_now()) {
    s_wakeup = wakeup_schedule((time_t)s_timer.deadline, (int32_t)s_timer.run, true);
    s_alarm_error = s_wakeup < 0;
  }
  if (s_wakeup >= 0) persist_write_int(WAKEUP_KEY, s_wakeup);
  else persist_delete(WAKEUP_KEY);
#if defined(ACTIVITY_TIMER_DIAGNOSTICS) && ACTIVITY_TIMER_DIAGNOSTICS
  time_t scheduled_at = 0;
  bool found = s_wakeup >= 0 && wakeup_query(s_wakeup, &scheduled_at);
  TIMER_DIAG("schedule now=%lu state=%lu run=%lu id=%ld query=%d at=%lu deadline=%lu",
      (unsigned long)prv_now(), (unsigned long)s_timer.state, (unsigned long)s_timer.run,
      (long)s_wakeup, found, (unsigned long)scheduled_at, (unsigned long)s_timer.deadline);
#endif
}

static void prv_retry(void *context) {
  (void)context;
  s_retry_timer = NULL;
  if (s_publisher.awaiting_receipt) {
    ++s_retries;
    pa_publisher_retry(&s_publisher);
  }
  prv_flush();
  prv_refresh();
}

static void prv_publish(void) {
  prv_identity();
  pa_publisher_update(&s_publisher, s_run_id, s_timer.revision);
  s_retries = 0;
  s_share_error = false;
  prv_flush();
}

static bool prv_apply(const ActivityTimerModel *next) {
  if (!prv_save(next)) {
    prv_refresh();
    return false;
  }
  s_timer = *next;
  prv_schedule_alarm();
  prv_publish();
  prv_refresh();
  return true;
}

static bool prv_finish(void) {
  ActivityTimerModel next = s_timer;
  if (!activity_timer_finish_if_due(&next, prv_now())) return false;
  TIMER_DIAG("finish now=%lu deadline=%lu run=%lu", (unsigned long)prv_now(),
      (unsigned long)s_timer.deadline, (unsigned long)s_timer.run);
  if (!prv_apply(&next)) {
    /* Alert locally even when flash failed; the failure stays visible. */
    s_timer = next;
    wakeup_cancel_all();
    s_alarm_error = true;
    prv_refresh();
  }
  if (!quiet_time_is_active()) vibes_double_pulse();
  return true;
}

static void prv_flush(void) {
  if (!s_phone_ready ||
      !connection_service_peek_pebble_app_connection()) return;
  if (s_retries >= RETRY_LIMIT) {
    s_share_error = true;
    prv_refresh();
    return;
  }
  PaPublication publication;
  if (!pa_publisher_begin(&s_publisher, &publication)) return;
  s_transport_ticket = publication.ticket;
  if (persist_write_data(PUBLICATION_KEY, &s_publisher.next_ticket,
      sizeof(s_publisher.next_ticket)) != (int)sizeof(s_publisher.next_ticket)) {
    pa_publisher_transport_result(&s_publisher, publication.ticket, false);
    s_share_error = true;
    return;
  }
  DictionaryIterator *out;
  AppMessageResult result = app_message_outbox_begin(&out);
  if (result != APP_MSG_OK) {
    pa_publisher_transport_result(&s_publisher, publication.ticket, false);
    ++s_retries;
    if (!s_retry_timer && s_retries < RETRY_LIMIT)
      s_retry_timer = app_timer_register(500, prv_retry, NULL);
    if (s_retries >= RETRY_LIMIT) { s_share_error = true; prv_refresh(); }
    return;
  }
  const bool active = s_timer.state == ACTIVITY_TIMER_RUNNING || s_timer.state == ACTIVITY_TIMER_PAUSED;
  const char *state = s_timer.state == ACTIVITY_TIMER_RUNNING ? "active" :
      s_timer.state == ACTIVITY_TIMER_PAUSED ? "paused" :
      s_timer.state == ACTIVITY_TIMER_FINISHED ? "completed" : "cancelled";
  dict_write_uint8(out, MESSAGE_KEY_ACTIVITY_SCHEMA_VERSION, 1);
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_RUN, s_run_id);
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_REVISION, s_timer.revision);
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_PUBLISH_SESSION, publication.ticket);
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_STATE, state);
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_KIND, "timer");
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_CLOCK, active ? "deadline" : "none");
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_NAME, "Timer");
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_MAIN, "");
  dict_write_cstring(out, MESSAGE_KEY_ACTIVITY_FOOTER, "Timer");
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_OBSERVED_AT, s_timer.observed_at);
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_VALID_UNTIL, s_timer.valid_until);
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_DEADLINE,
      s_timer.state == ACTIVITY_TIMER_RUNNING ? s_timer.deadline : 0);
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_DURATION,
      s_timer.state == ACTIVITY_TIMER_PAUSED ? s_timer.remaining_seconds : 0);
  dict_write_uint32(out, MESSAGE_KEY_ACTIVITY_CLOCK_AT, 0);
  dict_write_uint8(out, MESSAGE_KEY_ACTIVITY_PRIVATE, 0);
  dict_write_end(out);
  result = app_message_outbox_send();
  if (result != APP_MSG_OK) {
    pa_publisher_transport_result(&s_publisher, publication.ticket, false);
    ++s_retries;
    if (!s_retry_timer && s_retries < RETRY_LIMIT)
      s_retry_timer = app_timer_register(500, prv_retry, NULL);
    if (s_retries >= RETRY_LIMIT) { s_share_error = true; prv_refresh(); }
  }
}

static void prv_outbox_sent(DictionaryIterator *iter, void *context) {
  (void)context;
  uint32_t ticket = s_transport_ticket;
  if (iter) prv_u32(dict_find(iter, MESSAGE_KEY_ACTIVITY_PUBLISH_SESSION), &ticket);
  pa_publisher_transport_result(&s_publisher, ticket, true);
  /* Transport delivery is NOT a saved-snapshot acknowledgement. */
  prv_flush();
  if (s_publisher.awaiting_receipt && !s_retry_timer)
    s_retry_timer = app_timer_register(2000, prv_retry, NULL);
  prv_refresh();
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  (void)reason; (void)context;
  uint32_t ticket = s_transport_ticket;
  if (iter) prv_u32(dict_find(iter, MESSAGE_KEY_ACTIVITY_PUBLISH_SESSION), &ticket);
  if (!pa_publisher_transport_result(&s_publisher, ticket, false)) return;
  ++s_retries;
  if (s_retries >= RETRY_LIMIT) s_share_error = true;
  if (!s_retry_timer && s_retries < RETRY_LIMIT)
    s_retry_timer = app_timer_register(500, prv_retry, NULL);
  prv_refresh();
}

static void prv_inbox(DictionaryIterator *iter, void *context) {
  (void)context;
  Tuple *request = dict_find(iter, MESSAGE_KEY_ACTIVITY_REQUEST);
  uint32_t request_value;
  if (prv_u32(request, &request_value) && request_value) {
    s_phone_ready = true;
    pa_publisher_resync(&s_publisher);
    /* The phone store survives native app data resets; confirm above its floor. */
    Tuple *floor = dict_find(iter, MESSAGE_KEY_ACTIVITY_LAST_REVISION);
    uint32_t floor_value;
    ActivityTimerModel confirmed = s_timer;
    if (activity_timer_reconfirm(&confirmed, prv_now())) {
      if (prv_u32(floor, &floor_value) && floor_value >= confirmed.revision) {
        if (floor_value == UINT32_MAX) {
          s_share_error = true;
          prv_refresh();
          return;
        }
        confirmed.revision = floor_value + 1;
      }
      prv_apply(&confirmed);
    } else prv_publish();
  }
  const char *run = prv_string(dict_find(iter, MESSAGE_KEY_ACTIVITY_ACCEPTED_RUN));
  Tuple *revision = dict_find(iter, MESSAGE_KEY_ACTIVITY_ACCEPTED_REVISION);
  Tuple *ticket = dict_find(iter, MESSAGE_KEY_ACTIVITY_PUBLISH_SESSION);
  uint32_t revision_value, ticket_value;
  if (run && prv_u32(revision, &revision_value) && prv_u32(ticket, &ticket_value) &&
      pa_publisher_receipt(&s_publisher, run, revision_value, ticket_value)) {
    s_share_error = false;
    if (s_retry_timer) { app_timer_cancel(s_retry_timer); s_retry_timer = NULL; }
  }
  const char *error = prv_string(dict_find(iter, MESSAGE_KEY_ACTIVITY_ERROR));
  const char *rejected_run = prv_string(dict_find(iter, MESSAGE_KEY_ACTIVITY_RUN));
  Tuple *rejected_revision = dict_find(iter, MESSAGE_KEY_ACTIVITY_REVISION);
  if (error && rejected_run && prv_u32(rejected_revision, &revision_value) &&
      prv_u32(ticket, &ticket_value) && ticket_value == s_publisher.flight.ticket &&
      !strcmp(rejected_run, s_run_id) && revision_value == s_timer.revision) s_share_error = true;
  prv_refresh();
}

static void prv_connection(bool connected) {
  s_phone_ready = connected;
  pa_publisher_set_connected(&s_publisher, connected);
  if (connected) prv_publish();
  prv_refresh();
}

static void prv_refresh(void) {
  if (!s_time) return;
  uint32_t seconds = activity_timer_remaining(&s_timer, prv_now());
  if (s_timer.state == ACTIVITY_TIMER_CANCELLED || s_timer.state == ACTIVITY_TIMER_FINISHED)
    seconds = s_timer.state == ACTIVITY_TIMER_FINISHED ? 0 : s_timer.configured_seconds;
  if (seconds >= 3600)
    snprintf(s_time_text, sizeof(s_time_text), "%lu:%02lu:%02lu", (unsigned long)(seconds / 3600),
        (unsigned long)((seconds / 60) % 60), (unsigned long)(seconds % 60));
  else
    snprintf(s_time_text, sizeof(s_time_text), "%lu:%02lu", (unsigned long)(seconds / 60),
        (unsigned long)(seconds % 60));
  text_layer_set_text(s_time, s_time_text);
  text_layer_set_font(s_time, fonts_get_system_font(seconds >= 3600 ?
      FONT_KEY_BITHAM_34_MEDIUM_NUMBERS : FONT_KEY_BITHAM_42_BOLD));
  const bool active = s_timer.state == ACTIVITY_TIMER_RUNNING || s_timer.state == ACTIVITY_TIMER_PAUSED;
  text_layer_set_text(s_state_label, s_timer.state == ACTIVITY_TIMER_RUNNING ? "Running" :
      s_timer.state == ACTIVITY_TIMER_PAUSED ? "Paused" :
      s_timer.state == ACTIVITY_TIMER_FINISHED ? "Finished" : s_timer.run ? "Cancelled" : "Ready");
  text_layer_set_text(s_sharing, s_storage_error ? "Storage failed; keep app open" :
      s_alarm_error ? "Alarm not set; keep app open" :
      !connection_service_peek_pebble_app_connection() ? "Phone disconnected" :
      s_share_error ? "Sharing unavailable" :
      pa_publisher_synchronized(&s_publisher) ? "Shared with phone" : "Waiting to share");
  text_layer_set_text(s_controls, active ?
      "Select: pause/resume\nUp: +1 min   Down: cancel\nBack: leave timer running" :
      "Select: start\nUp: +1 min   Down: -1 min\nBack: return to watchface");
}

static void prv_select(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer; (void)context;
  if (prv_finish()) return;
  ActivityTimerModel next = s_timer;
  bool changed = next.state == ACTIVITY_TIMER_RUNNING ? activity_timer_pause(&next, prv_now()) :
      next.state == ACTIVITY_TIMER_PAUSED ? activity_timer_resume(&next, prv_now()) :
      activity_timer_start(&next, next.configured_seconds, prv_now());
  if (changed) prv_apply(&next);
}

static void prv_up(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer; (void)context;
  if (prv_finish()) return;
  ActivityTimerModel next = s_timer;
  if (next.state == ACTIVITY_TIMER_RUNNING || next.state == ACTIVITY_TIMER_PAUSED) {
    if (activity_timer_extend(&next, 60, prv_now())) prv_apply(&next);
  } else if (next.configured_seconds <= ACTIVITY_TIMER_MAX_SECONDS - 60) {
    next.configured_seconds += 60;
    if (prv_save(&next)) s_timer = next;
    prv_refresh();
  }
}

static void prv_down(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer; (void)context;
  if (prv_finish()) return;
  ActivityTimerModel next = s_timer;
  if (next.state == ACTIVITY_TIMER_RUNNING || next.state == ACTIVITY_TIMER_PAUSED) {
    if (activity_timer_cancel(&next, prv_now())) prv_apply(&next);
  } else if (next.configured_seconds > ACTIVITY_TIMER_MIN_SECONDS) {
    next.configured_seconds = next.configured_seconds > 60 ? next.configured_seconds - 60 : ACTIVITY_TIMER_MIN_SECONDS;
    if (prv_save(&next)) s_timer = next;
    prv_refresh();
  }
}

static void prv_click_config(void *context) {
  (void)context;
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select);
  window_single_click_subscribe(BUTTON_ID_UP, prv_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_down);
  /* Default Back always remains available, including when sharing is offline. */
}

static void prv_tick(struct tm *tick_time, TimeUnits units_changed) {
  (void)tick_time; (void)units_changed;
  prv_finish();
  prv_refresh();
}

static void prv_wakeup(WakeupId id, int32_t cookie) {
  (void)id; (void)cookie;
  TIMER_DIAG("wakeup callback now=%lu id=%ld cookie=%ld", (unsigned long)prv_now(),
      (long)id, (long)cookie);
  prv_finish();
}

static TextLayer *prv_text(Layer *parent, GRect bounds, const char *font) {
  TextLayer *layer = text_layer_create(bounds);
  text_layer_set_font(layer, fonts_get_system_font(font));
  text_layer_set_text_alignment(layer, GTextAlignmentCenter);
  text_layer_set_background_color(layer, GColorClear);
  text_layer_set_text_color(layer, GColorBlack);
  layer_add_child(parent, text_layer_get_layer(layer));
  return layer;
}

static void prv_init(void) {
  /* Cold Wakeups are launch events, not subscribed foreground callbacks. Read
   * their payload in production before reconciling the persisted owner state. */
  AppLaunchReason reason = launch_reason();
  WakeupId launch_id = -1;
  int32_t launch_cookie = 0;
  bool wakeup_launch = wakeup_get_launch_event(&launch_id, &launch_cookie);
  TIMER_DIAG("launch now=%lu reason=%d wakeup=%d id=%ld cookie=%ld", (unsigned long)prv_now(),
      (int)reason, wakeup_launch, (long)launch_id, (long)launch_cookie);
  if (persist_read_data(MODEL_KEY, &s_timer, sizeof(s_timer)) != (int)sizeof(s_timer) ||
      !activity_timer_valid(&s_timer)) {
    time_t seconds;
    uint16_t millis;
    time_ms(&seconds, &millis);
    uint32_t origin = (uint32_t)seconds ^ ((uint32_t)millis << 20);
    activity_timer_init(&s_timer, origin, prv_now());
    prv_save(&s_timer);
  }
  bool matching_wakeup = reason == APP_LAUNCH_WAKEUP && wakeup_launch &&
      persist_exists(WAKEUP_KEY) && persist_read_int(WAKEUP_KEY) == launch_id &&
      (uint32_t)launch_cookie == s_timer.run;
  prv_identity();
  uint32_t previous_ticket = 0;
  persist_read_data(PUBLICATION_KEY, &previous_ticket, sizeof(previous_ticket));
  pa_publisher_init(&s_publisher, previous_ticket,
      connection_service_peek_pebble_app_connection());
  s_window = window_create();
  window_set_background_color(s_window, GColorWhite);
  window_set_click_config_provider(s_window, prv_click_config);
  Layer *root = window_get_root_layer(s_window);
  int16_t width = layer_get_bounds(root).size.w;
  s_title = prv_text(root, GRect(6, 5, width - 12, 30), FONT_KEY_GOTHIC_24_BOLD);
  s_time = prv_text(root, GRect(6, 45, width - 12, 55), FONT_KEY_BITHAM_42_BOLD);
  s_state_label = prv_text(root, GRect(6, 102, width - 12, 30), FONT_KEY_GOTHIC_24_BOLD);
  s_sharing = prv_text(root, GRect(4, 134, width - 8, 34), FONT_KEY_GOTHIC_14);
  s_controls = prv_text(root, GRect(4, 172, width - 8, 52), FONT_KEY_GOTHIC_14);
  text_layer_set_text(s_title, "Activity Timer");
  app_message_register_inbox_received(prv_inbox);
  app_message_register_outbox_sent(prv_outbox_sent);
  app_message_register_outbox_failed(prv_outbox_failed);
  app_message_open(512, 1024);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler = prv_connection});
  wakeup_service_subscribe(prv_wakeup);
  tick_timer_service_subscribe(SECOND_UNIT, prv_tick);
  s_phone_ready = connection_service_peek_pebble_app_connection();
  bool finished_from_wakeup = matching_wakeup && prv_finish();
  if (!finished_from_wakeup && !prv_finish()) {
    ActivityTimerModel confirmed = s_timer;
    if (activity_timer_reconfirm(&confirmed, prv_now()) && prv_save(&confirmed)) s_timer = confirmed;
    prv_schedule_alarm();
  }
  prv_publish();
  prv_refresh();
  window_stack_push(s_window, true);
}

static void prv_deinit(void) {
#if defined(ACTIVITY_TIMER_DIAGNOSTICS) && ACTIVITY_TIMER_DIAGNOSTICS
  time_t scheduled_at = 0;
  bool found = s_wakeup >= 0 && wakeup_query(s_wakeup, &scheduled_at);
  TIMER_DIAG("exit now=%lu id=%ld query=%d at=%lu state=%lu", (unsigned long)prv_now(),
      (long)s_wakeup, found, (unsigned long)scheduled_at, (unsigned long)s_timer.state);
#endif
  if (s_retry_timer) app_timer_cancel(s_retry_timer);
  tick_timer_service_unsubscribe();
  connection_service_unsubscribe();
  app_message_deregister_callbacks();
  /* Wakeup and the already-persisted timer survive closing the foreground app. */
  text_layer_destroy(s_title);
  text_layer_destroy(s_time);
  text_layer_destroy(s_state_label);
  text_layer_destroy(s_sharing);
  text_layer_destroy(s_controls);
  window_destroy(s_window);
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
