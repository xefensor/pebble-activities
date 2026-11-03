#ifndef PEBBLE_ACTIVITY_VIEW_H
#define PEBBLE_ACTIVITY_VIEW_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PAV_WIRE_VERSION 2u
#define PAV_SUMMARY_WIRE_VERSION 3u
#define PAV_SUMMARY_RECORD_HEADER_BYTES 104u
#define PAV_SUMMARY_STRING_BYTES 304u
#define PAV_MAX_CARDS 2u
#define PAV_HEADER_BYTES 24u
#define PAV_RECORD_HEADER_BYTES 88u
#define PAV_DATUM_BYTES 28u
#define PAV_MAX_PACKET_BYTES 2672u
#define PAV_PROVIDER_BYTES 36u
#define PAV_ID_BYTES 64u
#define PAV_STRING_BYTES 320u
#define PAV_TEXT_BYTES 192u
#define PAV_LABEL_BYTES 64u
#define PAV_CAPTION_BYTES 128u
#define PAV_IMAGE_MAX_WIDTH 40u
#define PAV_IMAGE_MAX_HEIGHT 40u
#define PAV_IMAGE_MAX_BYTES 800u
#define PAV_PALETTE_BYTES 16u

enum { PAV_ACTIVE = 1, PAV_PAUSED = 2, PAV_COMPLETED = 3, PAV_CANCELLED = 4 };
enum { PAV_NONE = 0, PAV_TEXT = 1, PAV_VALUE = 2, PAV_CLOCK = 3 };
enum { PAV_PRIVATE = 1u, PAV_SOURCE_UNCONFIRMED = 2u,
       PAV_SHOW_TERMINAL = 4u, PAV_HAS_IMAGE = 8u };
enum { PAV_ELAPSED = 1u, PAV_RUNNING = 2u, PAV_RETAIN = 4u,
       PAV_ESTIMATED = 8u };
enum { PAV_PRESENTATION_TEXT = 1, PAV_PRESENTATION_MEDIA = 2,
       PAV_PRESENTATION_CLOCK = 3, PAV_PRESENTATION_VALUE = 4,
       PAV_PRESENTATION_RANGED = 5 };
enum { PAV_SYMBOL_ACTIVITY = 0, PAV_SYMBOL_TIMER = 1, PAV_SYMBOL_STOPWATCH = 2,
       PAV_SYMBOL_MEDIA = 3, PAV_SYMBOL_MESSAGE = 4, PAV_SYMBOL_CALL = 5,
       PAV_SYMBOL_NAVIGATION = 6, PAV_SYMBOL_WORKOUT = 7, PAV_SYMBOL_RECORDING = 8,
       PAV_SYMBOL_DOWNLOAD = 9, PAV_SYMBOL_DELIVERY = 10 };
enum { PAV_DIRECTION_NONE = 0, PAV_DIRECTION_LEFT = 1, PAV_DIRECTION_RIGHT = 2,
       PAV_DIRECTION_STRAIGHT = 3, PAV_DIRECTION_UTURN = 4 };
enum { PAV_METER_NONE = 0, PAV_METER_PROGRESS = 1, PAV_METER_LEVEL = 2 };

/* Offsets refer to NUL-terminated UTF-8 strings in the owning card's pool.
 * Running clocks use base +/- max(0, now - anchor); source lifecycle does not
 * imply that every clock is running or paused. */
typedef struct {
  uint32_t observed_at, valid_until;
  uint32_t base_seconds, anchor_at;
  uint16_t text_offset, text_length, label_offset, label_length;
  uint8_t type, flags;
} PavDatum;

typedef struct {
  char provider[PAV_PROVIDER_BYTES + 1u], id[PAV_ID_BYTES + 1u];
  uint32_t source_revision, source_observed_at, source_valid_until;
  PavDatum main, support;
  uint16_t caption_offset, caption_length;
  uint16_t meter, pixel_bytes;
  uint8_t source_state, flags, meter_kind, meter_source, width, height;
  uint8_t presentation, identity_symbol, compact_item, directions[2];
  uint16_t qualifier_offset, qualifier_length;
  uint8_t visual_token[8];
  uint8_t palette[PAV_PALETTE_BYTES], pixels[PAV_IMAGE_MAX_BYTES];
  char strings[PAV_STRING_BYTES];
} PavCard;

typedef struct {
  uint32_t session, view_sequence, sent_at;
  uint8_t count, wire_version;
  PavCard items[PAV_MAX_CARDS];
} PavSnapshot;

typedef struct {
  PavSnapshot snapshot;
  uint32_t session_token, last_sequence;
  bool connected;
} PavState;

typedef struct {
  uint32_t seconds;
  bool estimated, due, running;
} PavClockValue;

uint16_t pav_packet_crc16(const uint8_t *bytes, size_t length);
/* Strict two-pass decoding. A failed decode leaves *output unchanged.
 * Passing NULL validates without allocation or a second snapshot copy. */
bool pav_decode(const uint8_t *bytes, size_t length, PavSnapshot *output);
void pav_state_init(PavState *state, uint32_t session_token, bool connected);
void pav_state_set_session(PavState *state, uint32_t session_token);
bool pav_state_set_connected(PavState *state, bool connected);
bool pav_state_receive(PavState *state, const uint8_t *bytes, size_t length,
                       uint32_t now);
uint32_t pav_state_prune(PavState *state, uint32_t now);
const PavCard *pav_state_select(const PavState *state, uint32_t now, unsigned index);
bool pav_card_visible(const PavCard *card, uint32_t now, bool connected);
bool pav_datum_visible(const PavCard *card, const PavDatum *datum,
                       uint32_t now, bool connected);
bool pav_meter_visible(const PavCard *card, uint32_t now, bool connected);
bool pav_card_same_run(const PavCard *a, const PavCard *b);
PavClockValue pav_clock_value(const PavCard *card, const PavDatum *datum,
                              uint32_t now, bool connected);
bool pav_format_duration(uint32_t seconds, char *buffer, size_t capacity);
bool pav_format_item(const PavCard *card, const PavDatum *datum, uint32_t now,
                     bool connected, char *buffer, size_t capacity);
const char *pav_caption(const PavCard *card);
const char *pav_qualifier(const PavCard *card);
const char *pav_text(const PavCard *card, const PavDatum *datum);
const char *pav_label(const PavCard *card, const PavDatum *datum);

#ifdef __cplusplus
}
#endif
#endif
