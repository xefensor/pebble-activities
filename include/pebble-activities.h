#ifndef PEBBLE_ACTIVITIES_H
#define PEBBLE_ACTIVITIES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PA_WIRE_VERSION 1u
#define PA_MAX_ACTIVITIES 2u
#define PA_HEADER_BYTES 24u
#define PA_RECORD_HEADER_BYTES 48u
#define PA_MAX_PACKET_BYTES 2672u
#define PA_PROVIDER_BYTES 36u
#define PA_ID_BYTES 64u
#define PA_KIND_BYTES 24u
#define PA_MAIN_BYTES 192u
#define PA_FOOTER_BYTES 128u
#define PA_UNIT_BYTES 16u
#define PA_IMAGE_MAX_WIDTH 40u
#define PA_IMAGE_MAX_HEIGHT 40u
#define PA_IMAGE_MAX_BYTES 800u
#define PA_PALETTE_BYTES 16u

typedef enum {
  PA_ACTIVE = 1,
  PA_PAUSED = 2,
  PA_COMPLETED = 3,
  PA_CANCELLED = 4
} PaActivityState;

typedef enum {
  PA_CLOCK_NONE = 0,
  PA_CLOCK_DEADLINE = 1,
  PA_CLOCK_ELAPSED = 2
} PaClock;

enum {
  PA_FLAG_PRIVATE = 1u,
  PA_FLAG_IMAGE = 2u,
  PA_FLAG_NUMERIC = 4u,
  PA_FLAG_UNCONFIRMED = 8u
};

/* Independent of Pebble SDK services, fonts, Core and renderer coordinates.
 * Strings are bounded UTF-8 with an additional trailing NUL. Palette entries
 * are Pebble ARGB8 values. Each row has ceil(width / 2) packed pixel bytes;
 * its first pixel uses the high nibble. Odd-row low padding nibbles are zero.
 * All timestamps are UTC epoch seconds; duration values are seconds. */
typedef struct {
  char provider[PA_PROVIDER_BYTES + 1u];
  char id[PA_ID_BYTES + 1u];
  char kind[PA_KIND_BYTES + 1u];
  char main[PA_MAIN_BYTES + 1u];
  char footer[PA_FOOTER_BYTES + 1u];
  char unit[PA_UNIT_BYTES + 1u];
  uint32_t revision;
  uint32_t observed_at;
  uint32_t valid_until;
  uint32_t deadline;
  uint32_t base_seconds;
  uint32_t clock_at;
  double value;
  PaActivityState state;
  PaClock clock;
  uint8_t flags;
  uint8_t width;
  uint8_t height;
  uint16_t pixel_bytes;
  uint8_t palette[PA_PALETTE_BYTES];
  uint8_t pixels[PA_IMAGE_MAX_BYTES];
} PaActivity;

typedef struct {
  uint32_t session;
  uint32_t sequence;
  uint32_t sent_at;
  uint8_t count;
  PaActivity items[PA_MAX_ACTIVITIES];
} PaSnapshot;

typedef struct {
  PaSnapshot snapshot;
  uint32_t session_token;
  uint32_t last_sequence;
  bool connected;
} PaState;

typedef struct {
  uint32_t seconds;
  bool estimated;
  bool due;
  bool running;
} PaClockValue;

/* A watchapp publisher tracks identity/receipts, not a second copy of its
 * timer or other authoritative payload. The host owns persistence, outbox
 * dictionaries, connection subscriptions and retry timers. */
typedef struct {
  char run_id[PA_ID_BYTES + 1u];
  uint32_t revision;
  uint32_t ticket;
} PaPublication;

typedef struct {
  char run_id[PA_ID_BYTES + 1u];
  uint32_t revision;
  uint32_t accepted_revision;
  uint32_t next_ticket;
  PaPublication flight;
  bool connected;
  bool transport_active;
  bool awaiting_receipt;
  bool receipt_allowed;
} PaPublisher;

/* CRC16-CCITT (seed ffff, polynomial 1021), omitting packet bytes 8 and 9. */
uint16_t pa_packet_crc16(const uint8_t *bytes, size_t length);

/* Strict, two-pass decoding. On failure, *output is unchanged. Passing NULL
 * output validates only. No allocation or SDK callbacks occur. */
bool pa_decode(const uint8_t *bytes, size_t length, PaSnapshot *output);

void pa_state_init(PaState *state, uint32_t session_token, bool connected);
/* A host rotates/persists the session on native startup or a new phone
 * runtime. Rotation clears previous snapshots and closes the old sequence. */
void pa_state_set_session(PaState *state, uint32_t session_token);
/* Disconnect immediately erases private payloads. Public countdown snapshots
 * may remain until their original expiry, displayed as last-reported state. */
bool pa_state_set_connected(PaState *state, bool connected);
/* Requires a matching session >= 2 and strictly increasing sequence. A
 * failed packet does not partly commit; malformed input clears old private
 * content, while late/wrong-session packets do not replace current state. */
bool pa_state_receive(PaState *state, const uint8_t *bytes, size_t length,
                      uint32_t now);
/* Erase expired records and return the earliest remaining absolute expiry. */
uint32_t pa_state_prune(PaState *state, uint32_t now);
/* Returns the nth visible active/paused activity in provider projection order.
 * Terminal records are retained for revision checks but are never displayed. */
const PaActivity *pa_state_select(const PaState *state, uint32_t now,
                                   unsigned index);
bool pa_activity_visible(const PaActivity *activity, uint32_t now);
bool pa_activity_same_run(const PaActivity *a, const PaActivity *b);

/* Advances only time. Never estimates distance/heart rate or invents an
 * authoritative completion event. A running deadline at zero is due=true,
 * not PA_COMPLETED. Clock rollback clamps to the recorded base and marks the
 * value estimated until a current provider snapshot arrives. */
PaClockValue pa_clock_value(const PaActivity *activity, uint32_t now,
                             bool connected);
bool pa_format_duration(uint32_t seconds, char *buffer, size_t capacity);

/* previous_ticket comes from the host's persistent namespace. Persist the
 * advanced next_ticket after a successful begin, before sending its payload.
 * This keeps old application receipts distinct after the watchapp relaunches. */
void pa_publisher_init(PaPublisher *publisher, uint32_t previous_ticket,
                        bool connected);
bool pa_publisher_update(PaPublisher *publisher, const char *run_id, uint32_t revision);
bool pa_publisher_set_connected(PaPublisher *publisher, bool connected);
/* A phone-ready bootstrap forces a fresh handoff of the latest current state. */
void pa_publisher_resync(PaPublisher *publisher);
bool pa_publisher_needs_publish(const PaPublisher *publisher);
bool pa_publisher_synchronized(const PaPublisher *publisher);
/* Begins only the newest pending revision; an in-flight transport is not
 * cancelled. A newer state may supersede an older one awaiting a receipt. */
bool pa_publisher_begin(PaPublisher *publisher, PaPublication *publication);
/* Reports protocol delivery only; successful transport never marks storage
 * accepted. The ticket distinguishes callbacks for obsolete sends. */
bool pa_publisher_transport_result(PaPublisher *publisher, uint32_t ticket, bool success);
/* Only an exact current run/revision/ticket application receipt can establish
 * accepted shared phone state. This does not promise crash-durable disk flush. */
bool pa_publisher_receipt(PaPublisher *publisher, const char *run_id,
                           uint32_t revision, uint32_t ticket);
/* Called by the host's bounded application-receipt timeout. It allows a new
 * ticket without replacing an active SDK transport operation. */
void pa_publisher_retry(PaPublisher *publisher);

#ifdef __cplusplus
}
#endif

#endif
