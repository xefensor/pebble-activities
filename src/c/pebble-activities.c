#include "pebble-activities.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  size_t offset;
  size_t strings;
  size_t next;
  uint8_t lengths[6];
} RecordLocation;

static uint16_t read16(const uint8_t *p) {
  return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t read32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
      ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static double read_double(const uint8_t *p) {
  uint64_t bits = 0;
  double value;
  for (unsigned i = 0; i < 8; ++i) bits |= (uint64_t)p[i] << (8u * i);
  memcpy(&value, &bits, sizeof(value));
  return value;
}

static bool zero_bytes(const uint8_t *p, size_t length) {
  for (size_t i = 0; i < length; ++i) if (p[i]) return false;
  return true;
}

/* RFC 3629, rejecting embedded NUL and control characters that cannot be
 * represented safely in the bounded native text fields. Main/footer may use
 * ordinary newlines and tabs; identifiers and units may not. */
static bool utf8(const uint8_t *p, size_t length, bool multiline) {
  size_t i = 0;
  while (i < length) {
    const uint8_t a = p[i++];
    if (a < 0x80) {
      if (a == 0 || a == 0x7f || (a < 0x20 &&
          !(multiline && (a == '\n' || a == '\t')))) return false;
      continue;
    }
    unsigned extra;
    uint32_t code;
    if (a >= 0xc2 && a <= 0xdf) { extra = 1; code = a & 0x1fu; }
    else if (a >= 0xe0 && a <= 0xef) { extra = 2; code = a & 0x0fu; }
    else if (a >= 0xf0 && a <= 0xf4) { extra = 3; code = a & 0x07u; }
    else return false;
    if (length - i < extra) return false;
    for (unsigned j = 0; j < extra; ++j) {
      const uint8_t b = p[i++];
      if ((b & 0xc0u) != 0x80u) return false;
      code = (code << 6) | (b & 0x3fu);
    }
    if ((extra == 1 && code < 0x80) || (extra == 2 && code < 0x800) ||
        (extra == 3 && code < 0x10000) || code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

static bool provider_uuid(const uint8_t *p, size_t length) {
  if (length != PA_PROVIDER_BYTES) return false;
  for (size_t i = 0; i < length; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (p[i] != '-') return false;
    } else if (!((p[i] >= '0' && p[i] <= '9') ||
                 (p[i] >= 'a' && p[i] <= 'f'))) return false;
  }
  return true;
}

static bool reserved_private_kind(const uint8_t *p, size_t length) {
  static const char *const kinds[] = {"music", "notification", "notifications"};
  for (unsigned k = 0; k < sizeof(kinds) / sizeof(kinds[0]); ++k) {
    if (strlen(kinds[k]) != length) continue;
    size_t i = 0;
    for (; i < length; ++i) {
      uint8_t c = p[i];
      if (c >= 'A' && c <= 'Z') c = (uint8_t)(c + ('a' - 'A'));
      if (c != (uint8_t)kinds[k][i]) break;
    }
    if (i == length) return true;
  }
  return false;
}

uint16_t pa_packet_crc16(const uint8_t *bytes, size_t length) {
  if (bytes == NULL) return 0;
  uint16_t crc = 0xffffu;
  for (size_t i = 0; i < length; ++i) {
    if (i == 8 || i == 9) continue;
    crc ^= (uint16_t)bytes[i] << 8;
    for (unsigned bit = 0; bit < 8; ++bit) {
      crc = (uint16_t)((crc & 0x8000u) ? ((uint32_t)crc << 1) ^ 0x1021u
                                     : (uint32_t)crc << 1);
    }
  }
  return crc;
}

static bool locate_record(const uint8_t *bytes, size_t length, size_t offset,
                          RecordLocation *location) {
  if (offset > length || length - offset < PA_RECORD_HEADER_BYTES) return false;
  const uint8_t *p = bytes + offset;
  const unsigned state = p[0], clock = p[1], flags = p[2];
  if (state < PA_ACTIVE || state > PA_CANCELLED || clock > PA_CLOCK_ELAPSED ||
      (flags & ~(PA_FLAG_PRIVATE | PA_FLAG_IMAGE | PA_FLAG_NUMERIC | PA_FLAG_UNCONFIRMED)) ||
      p[3] || p[46] || p[47]) return false;
  if ((flags & PA_FLAG_PRIVATE) && (flags & PA_FLAG_UNCONFIRMED)) return false;
  if (!read32(p + 4) || !read32(p + 8) ||
      read32(p + 12) < read32(p + 8)) return false;
  const uint32_t deadline = read32(p + 16), base = read32(p + 20),
      anchor = read32(p + 24);
  if (clock == PA_CLOCK_NONE && (deadline || base || anchor)) return false;
  if (clock == PA_CLOCK_DEADLINE) {
    if (state == PA_ACTIVE && (!deadline || base || anchor)) return false;
    if (state == PA_PAUSED && (deadline || anchor)) return false;
  }
  if (clock == PA_CLOCK_ELAPSED && (deadline ||
      (state == PA_ACTIVE && !anchor) || (state == PA_PAUSED && anchor))) return false;
  if ((state == PA_COMPLETED || state == PA_CANCELLED) && clock != PA_CLOCK_NONE)
    return false;
  if ((state == PA_ACTIVE || state == PA_PAUSED) && clock == PA_CLOCK_NONE &&
      !(flags & PA_FLAG_NUMERIC) && !p[39]) return false;
  if (flags & PA_FLAG_NUMERIC) {
    if (sizeof(double) != 8 || !isfinite(read_double(p + 28))) return false;
  } else if (!zero_bytes(p + 28, 8)) return false;

  const size_t maxima[6] = {PA_PROVIDER_BYTES, PA_ID_BYTES, PA_KIND_BYTES,
                           PA_MAIN_BYTES, PA_FOOTER_BYTES, PA_UNIT_BYTES};
  size_t position = offset + PA_RECORD_HEADER_BYTES;
  location->offset = offset;
  location->strings = position;
  for (unsigned i = 0; i < 6; ++i) {
    const size_t n = p[36 + i];
    if (n > maxima[i] || n > length - position) return false;
    if ((i < 3 && !n) || (i == 0 && !provider_uuid(bytes + position, n)) ||
        !utf8(bytes + position, n, i == 3 || i == 4)) return false;
    if (i == 2 && !(flags & PA_FLAG_PRIVATE) &&
        reserved_private_kind(bytes + position, n)) return false;
    location->lengths[i] = (uint8_t)n;
    position += n;
  }
  const unsigned width = p[42], height = p[43];
  const size_t pixel_bytes = read16(p + 44);
  if (flags & PA_FLAG_IMAGE) {
    if (!width || !height || width > PA_IMAGE_MAX_WIDTH ||
        height > PA_IMAGE_MAX_HEIGHT ||
        pixel_bytes != ((width + 1u) / 2u) * height ||
        pixel_bytes > PA_IMAGE_MAX_BYTES ||
        PA_PALETTE_BYTES + pixel_bytes > length - position) return false;
    if (width & 1u) {
      const size_t stride = (width + 1u) / 2u;
      for (unsigned row = 0; row < height; ++row)
        if (bytes[position + PA_PALETTE_BYTES + row * stride + stride - 1u] & 0x0fu)
          return false;
    }
    position += PA_PALETTE_BYTES + pixel_bytes;
  } else if (width || height || pixel_bytes) return false;
  location->next = position;
  return true;
}

static void decode_record(const uint8_t *bytes, const RecordLocation *where,
                           PaActivity *activity) {
  const uint8_t *p = bytes + where->offset;
  memset(activity, 0, sizeof(*activity));
  activity->state = (PaActivityState)p[0];
  activity->clock = (PaClock)p[1];
  activity->flags = p[2];
  activity->revision = read32(p + 4);
  activity->observed_at = read32(p + 8);
  activity->valid_until = read32(p + 12);
  activity->deadline = read32(p + 16);
  activity->base_seconds = read32(p + 20);
  activity->clock_at = read32(p + 24);
  if (activity->flags & PA_FLAG_NUMERIC) activity->value = read_double(p + 28);
  char *strings[6] = {activity->provider, activity->id, activity->kind,
                      activity->main, activity->footer, activity->unit};
  size_t from = where->strings;
  for (unsigned i = 0; i < 6; ++i) {
    memcpy(strings[i], bytes + from, where->lengths[i]);
    from += where->lengths[i];
  }
  if (activity->flags & PA_FLAG_IMAGE) {
    activity->width = p[42]; activity->height = p[43];
    activity->pixel_bytes = read16(p + 44);
    memcpy(activity->palette, bytes + from, PA_PALETTE_BYTES);
    memcpy(activity->pixels, bytes + from + PA_PALETTE_BYTES, activity->pixel_bytes);
  }
  /* A terminal record is a revision tombstone, never retained private display
   * content. Keep only the identity, revision, state and original lease. */
  if (activity->state == PA_COMPLETED || activity->state == PA_CANCELLED) {
    memset(activity->main, 0, sizeof(activity->main));
    memset(activity->footer, 0, sizeof(activity->footer));
    memset(activity->unit, 0, sizeof(activity->unit));
    memset(activity->palette, 0, sizeof(activity->palette));
    memset(activity->pixels, 0, sizeof(activity->pixels));
    activity->flags &= PA_FLAG_PRIVATE;
    activity->value = 0;
    activity->width = activity->height = 0;
    activity->pixel_bytes = 0;
  }
}

bool pa_decode(const uint8_t *bytes, size_t length, PaSnapshot *output) {
  if (bytes == NULL || length < PA_HEADER_BYTES || length > PA_MAX_PACKET_BYTES ||
      memcmp(bytes, "ACT1", 4) || bytes[4] != PA_WIRE_VERSION ||
      bytes[5] > PA_MAX_ACTIVITIES || read16(bytes + 6) != length ||
      bytes[10] || bytes[11] || read32(bytes + 12) < 2 || !read32(bytes + 16) ||
      !read32(bytes + 20) ||
      read16(bytes + 8) != pa_packet_crc16(bytes, length)) return false;
  RecordLocation records[PA_MAX_ACTIVITIES];
  size_t offset = PA_HEADER_BYTES;
  for (unsigned i = 0; i < bytes[5]; ++i) {
    if (!locate_record(bytes, length, offset, &records[i])) return false;
    offset = records[i].next;
    for (unsigned j = 0; j < i; ++j) {
      const size_t a = records[i].strings, b = records[j].strings;
      const size_t provider = records[i].lengths[0], id = records[i].lengths[1];
      if (provider == records[j].lengths[0] && id == records[j].lengths[1] &&
          !memcmp(bytes + a, bytes + b, provider) &&
          !memcmp(bytes + a + provider, bytes + b + provider, id)) return false;
    }
  }
  if (offset != length) return false;
  if (output != NULL) {
    memset(output, 0, sizeof(*output));
    output->session = read32(bytes + 12);
    output->sequence = read32(bytes + 16);
    output->sent_at = read32(bytes + 20);
    output->count = bytes[5];
    for (unsigned i = 0; i < output->count; ++i)
      decode_record(bytes, &records[i], &output->items[i]);
  }
  return true;
}

void pa_state_init(PaState *state, uint32_t session_token, bool connected) {
  if (state == NULL) return;
  memset(state, 0, sizeof(*state));
  state->session_token = session_token;
  state->connected = connected;
}

void pa_state_set_session(PaState *state, uint32_t session_token) {
  if (state == NULL) return;
  memset(&state->snapshot, 0, sizeof(state->snapshot));
  state->session_token = session_token;
  state->last_sequence = 0;
}

static void clear_private(PaState *state) {
  for (unsigned i = 0; i < state->snapshot.count; ++i) {
    if ((state->snapshot.items[i].flags & PA_FLAG_PRIVATE) ||
        state->snapshot.items[i].clock == PA_CLOCK_NONE)
      memset(&state->snapshot.items[i], 0, sizeof(state->snapshot.items[i]));
    else if (state->snapshot.items[i].provider[0])
      state->snapshot.items[i].flags |= PA_FLAG_UNCONFIRMED;
  }
}

bool pa_state_set_connected(PaState *state, bool connected) {
  if (state == NULL || state->connected == connected) return false;
  state->connected = connected;
  if (!connected) clear_private(state);
  return true;
}

bool pa_activity_same_run(const PaActivity *a, const PaActivity *b) {
  return a != NULL && b != NULL && a->provider[0] && b->provider[0] &&
      !strcmp(a->provider, b->provider) && !strcmp(a->id, b->id);
}

/* Source revisions describe immutable producer state. Transport uncertainty
 * is a local annotation and does not create a new producer revision. Compare
 * directly against the wire to avoid a second image-sized stack object. */
static bool same_revision_payload(const uint8_t *bytes, const RecordLocation *at,
                                  const PaActivity *old) {
  const uint8_t *r = bytes + at->offset;
  if (old->state != (PaActivityState)r[0] || old->clock != (PaClock)r[1] ||
      old->observed_at != read32(r + 8) || old->valid_until != read32(r + 12) ||
      old->deadline != read32(r + 16) || old->base_seconds != read32(r + 20) ||
      old->clock_at != read32(r + 24)) return false;
  const bool terminal = old->state == PA_COMPLETED || old->state == PA_CANCELLED;
  const unsigned flags = terminal ? (r[2] & PA_FLAG_PRIVATE)
                                   : (r[2] & ~PA_FLAG_UNCONFIRMED);
  if ((old->flags & ~PA_FLAG_UNCONFIRMED) != flags) return false;
  if (!terminal && (flags & PA_FLAG_NUMERIC) && old->value != read_double(r + 28))
    return false;
  const char *strings[6] = {old->provider, old->id, old->kind, old->main,
                            old->footer, old->unit};
  size_t position = at->strings;
  for (unsigned i = 0; i < 6; ++i) {
    const size_t n = at->lengths[i];
    if ((!terminal || i < 3) &&
        (strlen(strings[i]) != n || memcmp(strings[i], bytes + position, n))) return false;
    position += n;
  }
  if (!terminal && (flags & PA_FLAG_IMAGE)) {
    if (old->width != r[42] || old->height != r[43] ||
        old->pixel_bytes != read16(r + 44) ||
        memcmp(old->palette, bytes + position, PA_PALETTE_BYTES) ||
        memcmp(old->pixels, bytes + position + PA_PALETTE_BYTES, old->pixel_bytes)) return false;
  }
  return true;
}

bool pa_state_receive(PaState *state, const uint8_t *bytes, size_t length,
                      uint32_t now) {
  if (state == NULL) return false;
  if (!pa_decode(bytes, length, NULL)) {
    clear_private(state);
    return false;
  }
  if (!state->connected || !state->session_token ||
      read32(bytes + 12) != state->session_token ||
      read32(bytes + 16) <= state->last_sequence) return false;

  /* Check per-run rollback before mutating. Compare identities in the wire
   * directly so receiving two images does not require a large stack copy. */
  size_t offset = PA_HEADER_BYTES;
  for (unsigned i = 0; i < bytes[5]; ++i) {
    const uint8_t *record = bytes + offset;
    RecordLocation at;
    if (!locate_record(bytes, length, offset, &at)) return false;
    for (unsigned j = 0; j < state->snapshot.count; ++j) {
      const PaActivity *old = &state->snapshot.items[j];
      if (strlen(old->provider) == at.lengths[0] && strlen(old->id) == at.lengths[1] &&
          !memcmp(old->provider, bytes + at.strings, at.lengths[0]) &&
          !memcmp(old->id, bytes + at.strings + at.lengths[0], at.lengths[1])) {
        const uint32_t revision = read32(record + 4);
        if (revision < old->revision ||
            (revision == old->revision && !same_revision_payload(bytes, &at, old)) ||
            ((old->state == PA_COMPLETED || old->state == PA_CANCELLED) &&
             (record[0] == PA_ACTIVE || record[0] == PA_PAUSED))) return false;
      }
    }
    offset = at.next;
  }
  if (!pa_decode(bytes, length, &state->snapshot)) return false;
  state->last_sequence = state->snapshot.sequence;
  pa_state_prune(state, now);
  return true;
}

uint32_t pa_state_prune(PaState *state, uint32_t now) {
  if (state == NULL) return 0;
  uint32_t next = 0;
  for (unsigned i = 0; i < state->snapshot.count; ++i) {
    PaActivity *activity = &state->snapshot.items[i];
    if (!activity->valid_until || activity->valid_until <= now) {
      memset(activity, 0, sizeof(*activity));
    } else if (!next || activity->valid_until < next) next = activity->valid_until;
  }
  return next;
}

bool pa_activity_visible(const PaActivity *activity, uint32_t now) {
  return activity != NULL && activity->provider[0] && activity->id[0] &&
      (activity->state == PA_ACTIVE || activity->state == PA_PAUSED) &&
      activity->valid_until > now;
}

const PaActivity *pa_state_select(const PaState *state, uint32_t now, unsigned index) {
  if (state == NULL) return NULL;
  for (unsigned i = 0; i < state->snapshot.count; ++i) {
    const PaActivity *activity = &state->snapshot.items[i];
    if (pa_activity_visible(activity, now) &&
        (state->connected || !(activity->flags & PA_FLAG_PRIVATE))) {
      if (!index) return activity;
      --index;
    }
  }
  return NULL;
}

PaClockValue pa_clock_value(const PaActivity *activity, uint32_t now, bool connected) {
  PaClockValue result = {0};
  if (activity == NULL) return result;
  result.estimated = !connected || (activity->flags & PA_FLAG_UNCONFIRMED) ||
      now < activity->observed_at;
  result.running = activity->state == PA_ACTIVE && activity->clock != PA_CLOCK_NONE;
  if (activity->state == PA_COMPLETED || activity->state == PA_CANCELLED) return result;
  if (activity->state == PA_PAUSED) {
    result.seconds = activity->base_seconds;
  } else if (activity->clock == PA_CLOCK_DEADLINE) {
    const uint32_t reference = now < activity->observed_at ? activity->observed_at : now;
    result.seconds = activity->deadline > reference ? activity->deadline - reference : 0;
    result.due = reference >= activity->deadline;
  } else if (activity->clock == PA_CLOCK_ELAPSED) {
    uint64_t value = activity->base_seconds;
    if (now >= activity->clock_at) value += now - activity->clock_at;
    else result.estimated = true;
    result.seconds = value > UINT32_MAX ? UINT32_MAX : (uint32_t)value;
  }
  return result;
}

bool pa_format_duration(uint32_t seconds, char *buffer, size_t capacity) {
  if (buffer == NULL || !capacity) return false;
  int n;
  if (seconds >= 3600u)
    n = snprintf(buffer, capacity, "%lu:%02lu:%02lu", (unsigned long)(seconds / 3600u),
                 (unsigned long)((seconds / 60u) % 60u), (unsigned long)(seconds % 60u));
  else
    n = snprintf(buffer, capacity, "%02lu:%02lu", (unsigned long)(seconds / 60u),
                 (unsigned long)(seconds % 60u));
  return n >= 0 && (size_t)n < capacity;
}

void pa_publisher_init(PaPublisher *publisher, uint32_t previous_ticket, bool connected) {
  if (publisher == NULL) return;
  memset(publisher, 0, sizeof(*publisher));
  publisher->next_ticket = previous_ticket;
  publisher->connected = connected;
}

bool pa_publisher_update(PaPublisher *publisher, const char *run_id, uint32_t revision) {
  if (publisher == NULL || run_id == NULL || !revision) return false;
  size_t length = 0;
  while (length <= PA_ID_BYTES && run_id[length]) ++length;
  if (!length || length > PA_ID_BYTES || !utf8((const uint8_t *)run_id, length, false))
    return false;
  if (!strcmp(publisher->run_id, run_id)) {
    if (revision < publisher->revision) return false;
  } else {
    memset(publisher->run_id, 0, sizeof(publisher->run_id));
    memcpy(publisher->run_id, run_id, length);
    publisher->accepted_revision = 0;
  }
  publisher->revision = revision;
  return true;
}

void pa_publisher_resync(PaPublisher *publisher) {
  if (publisher == NULL) return;
  publisher->accepted_revision = 0;
  publisher->awaiting_receipt = false;
  publisher->receipt_allowed = false;
}

bool pa_publisher_set_connected(PaPublisher *publisher, bool connected) {
  if (publisher == NULL || publisher->connected == connected) return false;
  publisher->connected = connected;
  pa_publisher_resync(publisher);
  return true;
}

bool pa_publisher_synchronized(const PaPublisher *publisher) {
  return publisher != NULL && publisher->connected && publisher->run_id[0] &&
      publisher->revision && publisher->accepted_revision == publisher->revision;
}

bool pa_publisher_needs_publish(const PaPublisher *publisher) {
  return publisher != NULL && publisher->connected && publisher->run_id[0] &&
      publisher->revision && !pa_publisher_synchronized(publisher);
}

static bool publication_is_current(const PaPublisher *publisher) {
  return publisher->revision == publisher->flight.revision &&
      !strcmp(publisher->run_id, publisher->flight.run_id);
}

bool pa_publisher_begin(PaPublisher *publisher, PaPublication *publication) {
  if (publisher == NULL || publication == NULL || publisher->transport_active ||
      !pa_publisher_needs_publish(publisher) ||
      (publisher->awaiting_receipt && publication_is_current(publisher))) return false;
  uint32_t ticket = publisher->next_ticket + 1u;
  if (!ticket) ticket = 1;
  publisher->next_ticket = ticket;
  memset(&publisher->flight, 0, sizeof(publisher->flight));
  memcpy(publisher->flight.run_id, publisher->run_id, sizeof(publisher->run_id));
  publisher->flight.revision = publisher->revision;
  publisher->flight.ticket = ticket;
  publisher->transport_active = true;
  publisher->awaiting_receipt = false;
  publisher->receipt_allowed = true;
  *publication = publisher->flight;
  return true;
}

bool pa_publisher_transport_result(PaPublisher *publisher, uint32_t ticket, bool success) {
  if (publisher == NULL || !publisher->transport_active ||
      !ticket || ticket != publisher->flight.ticket) return false;
  publisher->transport_active = false;
  publisher->awaiting_receipt = success && publisher->receipt_allowed &&
      publication_is_current(publisher) &&
      !pa_publisher_synchronized(publisher);
  return true;
}

bool pa_publisher_receipt(PaPublisher *publisher, const char *run_id,
                           uint32_t revision, uint32_t ticket) {
  if (publisher == NULL || run_id == NULL || !publisher->connected ||
      !publisher->receipt_allowed || !ticket ||
      ticket != publisher->flight.ticket || revision != publisher->flight.revision ||
      strcmp(run_id, publisher->flight.run_id) || !publication_is_current(publisher)) return false;
  if (pa_publisher_synchronized(publisher)) return false;
  publisher->accepted_revision = revision;
  publisher->awaiting_receipt = false;
  return true;
}

void pa_publisher_retry(PaPublisher *publisher) {
  if (publisher != NULL) publisher->awaiting_receipt = false;
}
