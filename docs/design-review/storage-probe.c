/* Allocation experiment only. This is not an ACT2 wire layout or SDK package.
 * Compile for ARM with -Iinclude; inspect measured_* symbol sizes using nm.
 */
#include <stdint.h>
#include "pebble-activities.h"

typedef struct {
  uint32_t observed_at, valid_until;
  uint32_t base_seconds, anchor_at;
  uint16_t text_offset, text_length, label_offset, label_length;
  uint8_t type, flags;
} CandidateDatum;

typedef struct {
  char provider[37], id[65];
  uint32_t source_revision, source_observed_at, source_valid_until;
  CandidateDatum main, support;
  uint16_t caption_offset, caption_length;
  uint16_t meter, pixel_bytes;
  uint8_t source_state, flags, meter_kind, meter_source, width, height;
  uint8_t palette[16], pixels[800];
  /* Shared labels, text and caption, including their string terminators. */
  char strings[320];
} CandidateCard;

typedef struct {
  uint32_t session, view_sequence, sent_at;
  uint8_t count;
  CandidateCard items[2];
} CandidateSnapshot;

typedef struct {
  CandidateSnapshot snapshot;
  uint32_t session_token, last_sequence;
  uint8_t connected;
} CandidateState;

/* These arrays expose sizeof values in the object file. Do not link this probe
 * into an app: they deliberately allocate extra measurement-only storage. */
char measured_current_card[sizeof(PaActivity)];
char measured_current_snapshot[sizeof(PaSnapshot)];
char measured_current_state[sizeof(PaState)];
char measured_candidate_datum[sizeof(CandidateDatum)];
char measured_candidate_card[sizeof(CandidateCard)];
char measured_candidate_snapshot[sizeof(CandidateSnapshot)];
char measured_candidate_state[sizeof(CandidateState)];
