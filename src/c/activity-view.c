#include "pebble-activity-view.h"

#include <stdio.h>
#include <string.h>

typedef struct {
  size_t offset, next, pool, image;
  uint16_t pool_bytes;
  uint8_t id_bytes;
} RecordLocation;

static uint16_t read16(const uint8_t *p) {
  return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t read32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
      ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool zero_bytes(const uint8_t *p, size_t length) {
  for (size_t i = 0; i < length; ++i) if (p[i]) return false;
  return true;
}

static bool utf8(const uint8_t *p, size_t length) {
  size_t i = 0;
  while (i < length) {
    const uint8_t a = p[i++];
    if (a < 0x80) {
      if (a < 0x20 || a == 0x7f) return false;
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
        (code >= 0xd800 && code <= 0xdfff) || (code >= 0x80 && code <= 0x9f))
      return false;
  }
  return true;
}

static bool provider_uuid(const uint8_t *p) {
  for (size_t i = 0; i < PAV_PROVIDER_BYTES; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (p[i] != '-') return false;
    } else if (!((p[i] >= '0' && p[i] <= '9') ||
                 (p[i] >= 'a' && p[i] <= 'f'))) return false;
  }
  return true;
}

uint16_t pav_packet_crc16(const uint8_t *bytes, size_t length) {
  uint16_t crc = 0xffffu;
  if (!bytes) return 0;
  for (size_t i = 0; i < length; ++i) {
    if (i == 8 || i == 9) continue;
    crc ^= (uint16_t)bytes[i] << 8;
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (uint16_t)((crc & 0x8000u) ? ((uint32_t)crc << 1) ^ 0x1021u
                                     : (uint32_t)crc << 1);
  }
  return crc;
}

static bool valid_pool(const uint8_t *pool, size_t bytes) {
  size_t start = 0;
  if (!bytes || bytes > PAV_STRING_BYTES || pool[bytes - 1]) return false;
  for (size_t i = 0; i < bytes; ++i) {
    if (!pool[i]) {
      if (!utf8(pool + start, i - start)) return false;
      start = i + 1;
    }
  }
  return true;
}

static bool valid_ref(const uint8_t *pool, size_t pool_bytes, unsigned offset,
                       unsigned length) {
  return offset < pool_bytes && length < pool_bytes - offset &&
      pool[offset + length] == 0 && utf8(pool + offset, length);
}

static bool valid_datum(const uint8_t *p, const uint8_t *pool, size_t pool_bytes,
                         uint32_t source_observed, uint32_t source_valid,
                         bool required) {
  if (!p[0]) return !required && zero_bytes(p, PAV_DATUM_BYTES);
  if (p[0] > PAV_CLOCK || (p[1] & ~15u) || read16(p + 2)) return false;
  const uint32_t observed = read32(p + 4), valid = read32(p + 8);
  const uint32_t base = read32(p + 12), anchor = read32(p + 16);
  const unsigned text_offset = read16(p + 20), text_length = read16(p + 22);
  const unsigned label_offset = read16(p + 24), label_length = read16(p + 26);
  if (!observed || observed > source_observed || valid < observed || valid > source_valid ||
      !label_length || label_length > PAV_LABEL_BYTES || text_length > PAV_TEXT_BYTES ||
      !valid_ref(pool, pool_bytes, label_offset, label_length) ||
      !valid_ref(pool, pool_bytes, text_offset, text_length)) return false;
  if (p[0] != PAV_CLOCK)
    return text_length && !(p[1] & (PAV_ELAPSED | PAV_RUNNING)) && !base && !anchor;
  return p[1] & PAV_RUNNING ? anchor && anchor <= observed : !anchor;
}

static bool locate_record(const uint8_t *bytes, size_t length, size_t offset,
                           RecordLocation *out) {
  if (offset > length || length - offset < PAV_RECORD_HEADER_BYTES) return false;
  const uint8_t *p = bytes + offset;
  const size_t record_bytes = read16(p), pool_bytes = read16(p + 22);
  const unsigned flags = p[3], state = p[2], id_bytes = p[16];
  const unsigned width = p[17], height = p[18], meter_kind = p[19];
  const size_t pixels = read16(p + 20);
  if (record_bytes < PAV_RECORD_HEADER_BYTES || record_bytes > length - offset ||
      state < PAV_ACTIVE || state > PAV_CANCELLED || (flags & ~15u) ||
      ((flags & PAV_PRIVATE) && (flags & PAV_SOURCE_UNCONFIRMED)) ||
      !read32(p + 4) || !read32(p + 8) || read32(p + 12) < read32(p + 8) ||
      !id_bytes || id_bytes > PAV_ID_BYTES || p[31] || !pool_bytes ||
      pool_bytes > PAV_STRING_BYTES || meter_kind > PAV_METER_LEVEL || p[30] > 1)
    return false;
  const size_t pool = offset + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES + id_bytes;
  if (pool > offset + record_bytes || pool_bytes > offset + record_bytes - pool ||
      !provider_uuid(p + PAV_RECORD_HEADER_BYTES) ||
      !utf8(p + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES, id_bytes) ||
      !valid_pool(bytes + pool, pool_bytes) || read16(p + 26) > PAV_CAPTION_BYTES ||
      !valid_ref(bytes + pool, pool_bytes, read16(p + 24), read16(p + 26)) ||
      !valid_datum(p + 32, bytes + pool, pool_bytes, read32(p + 8), read32(p + 12), true) ||
      !valid_datum(p + 60, bytes + pool, pool_bytes, read32(p + 8), read32(p + 12), false))
    return false;
  if (!meter_kind) {
    if (read16(p + 28) || p[30]) return false;
  } else if (p[p[30] ? 60 : 32] != PAV_VALUE) return false;

  const size_t image = pool + pool_bytes;
  size_t expected = image - offset;
  if (flags & PAV_HAS_IMAGE) {
    if (!width || width > PAV_IMAGE_MAX_WIDTH || !height || height > PAV_IMAGE_MAX_HEIGHT ||
        pixels > PAV_IMAGE_MAX_BYTES || pixels != ((width + 1u) / 2u) * height)
      return false;
    expected += PAV_PALETTE_BYTES + pixels;
    if (expected != record_bytes) return false;
    if (width & 1u) {
      const size_t stride = (width + 1u) / 2u;
      for (unsigned row = 0; row < height; ++row)
        if (bytes[image + PAV_PALETTE_BYTES + row * stride + stride - 1u] & 0x0fu)
          return false;
    }
  } else if (width || height || pixels || expected != record_bytes) return false;
  out->offset = offset; out->next = offset + record_bytes;
  out->pool = pool; out->pool_bytes = (uint16_t)pool_bytes;
  out->image = image; out->id_bytes = (uint8_t)id_bytes;
  return true;
}

static void decode_datum(const uint8_t *p, PavDatum *datum) {
  datum->type = p[0]; datum->flags = p[1];
  datum->observed_at = read32(p + 4); datum->valid_until = read32(p + 8);
  datum->base_seconds = read32(p + 12); datum->anchor_at = read32(p + 16);
  datum->text_offset = read16(p + 20); datum->text_length = read16(p + 22);
  datum->label_offset = read16(p + 24); datum->label_length = read16(p + 26);
}

static void decode_record(const uint8_t *bytes, const RecordLocation *where,
                           PavCard *card) {
  const uint8_t *p = bytes + where->offset;
  memset(card, 0, sizeof(*card));
  memcpy(card->provider, p + PAV_RECORD_HEADER_BYTES, PAV_PROVIDER_BYTES);
  memcpy(card->id, p + PAV_RECORD_HEADER_BYTES + PAV_PROVIDER_BYTES, where->id_bytes);
  card->source_state = p[2]; card->flags = p[3];
  card->source_revision = read32(p + 4); card->source_observed_at = read32(p + 8);
  card->source_valid_until = read32(p + 12);
  card->caption_offset = read16(p + 24); card->caption_length = read16(p + 26);
  card->meter = read16(p + 28); card->meter_source = p[30]; card->meter_kind = p[19];
  decode_datum(p + 32, &card->main); decode_datum(p + 60, &card->support);
  memcpy(card->strings, bytes + where->pool, where->pool_bytes);
  if (card->flags & PAV_HAS_IMAGE) {
    card->width = p[17]; card->height = p[18]; card->pixel_bytes = read16(p + 20);
    memcpy(card->palette, bytes + where->image, PAV_PALETTE_BYTES);
    memcpy(card->pixels, bytes + where->image + PAV_PALETTE_BYTES, card->pixel_bytes);
  }
}

bool pav_decode(const uint8_t *bytes, size_t length, PavSnapshot *output) {
  if (!bytes || length < PAV_HEADER_BYTES || length > PAV_MAX_PACKET_BYTES ||
      memcmp(bytes, "ACT2", 4) || bytes[4] != PAV_WIRE_VERSION ||
      bytes[5] > PAV_MAX_CARDS || read16(bytes + 6) != length || bytes[10] || bytes[11] ||
      read32(bytes + 12) < 2 || !read32(bytes + 16) || !read32(bytes + 20) ||
      read16(bytes + 8) != pav_packet_crc16(bytes, length)) return false;
  RecordLocation records[PAV_MAX_CARDS];
  size_t offset = PAV_HEADER_BYTES;
  for (unsigned i = 0; i < bytes[5]; ++i) {
    if (!locate_record(bytes, length, offset, &records[i])) return false;
    offset = records[i].next;
    for (unsigned j = 0; j < i; ++j) {
      const size_t a = records[i].offset + PAV_RECORD_HEADER_BYTES;
      const size_t b = records[j].offset + PAV_RECORD_HEADER_BYTES;
      if (records[i].id_bytes == records[j].id_bytes &&
          !memcmp(bytes + a, bytes + b, PAV_PROVIDER_BYTES + records[i].id_bytes))
        return false;
    }
  }
  if (offset != length) return false;
  if (output) {
    memset(output, 0, sizeof(*output));
    output->session = read32(bytes + 12); output->view_sequence = read32(bytes + 16);
    output->sent_at = read32(bytes + 20); output->count = bytes[5];
    for (unsigned i = 0; i < output->count; ++i) decode_record(bytes, &records[i], &output->items[i]);
  }
  return true;
}

static bool source_visible(const PavCard *card, uint32_t now) {
  return card && card->provider[0] && card->id[0] && card->source_valid_until > now &&
      (card->source_state == PAV_ACTIVE || card->source_state == PAV_PAUSED ||
       ((card->flags & PAV_SHOW_TERMINAL) &&
        (card->source_state == PAV_COMPLETED || card->source_state == PAV_CANCELLED)));
}

static bool datum_visible(const PavCard *card, const PavDatum *datum,
                            uint32_t now, bool connected) {
  if (!source_visible(card, now) || !datum || !datum->type || datum->valid_until <= now)
    return false;
  const bool uncertain = !connected || (card->flags & PAV_SOURCE_UNCONFIRMED);
  return !uncertain || (!(card->flags & PAV_PRIVATE) && (datum->flags & PAV_RETAIN));
}

bool pav_card_visible(const PavCard *card, uint32_t now, bool connected) {
  return card && datum_visible(card, &card->main, now, connected);
}

bool pav_datum_visible(const PavCard *card, const PavDatum *datum,
                       uint32_t now, bool connected) {
  return card && (datum == &card->main || datum == &card->support) &&
      pav_card_visible(card, now, connected) && datum_visible(card, datum, now, connected);
}

bool pav_meter_visible(const PavCard *card, uint32_t now, bool connected) {
  return card && card->meter_kind && pav_datum_visible(card,
      card->meter_source ? &card->support : &card->main, now, connected);
}

void pav_state_init(PavState *state, uint32_t session_token, bool connected) {
  if (!state) return;
  memset(state, 0, sizeof(*state)); state->session_token = session_token;
  state->connected = connected;
}

void pav_state_set_session(PavState *state, uint32_t session_token) {
  if (!state) return;
  memset(&state->snapshot, 0, sizeof(state->snapshot));
  state->session_token = session_token; state->last_sequence = 0;
}

static void clear_meter(PavCard *card) {
  card->meter = card->meter_kind = card->meter_source = 0;
}

static void make_uncertain(PavState *state) {
  for (unsigned i = 0; i < state->snapshot.count; ++i) {
    PavCard *card = &state->snapshot.items[i];
    if ((card->flags & PAV_PRIVATE) || !(card->main.flags & PAV_RETAIN)) {
      memset(card, 0, sizeof(*card));
    } else if (card->provider[0]) {
      card->flags |= PAV_SOURCE_UNCONFIRMED;
      if (!(card->support.flags & PAV_RETAIN)) {
        memset(&card->support, 0, sizeof(card->support));
        if (card->meter_source) clear_meter(card);
      }
    }
  }
}

bool pav_state_set_connected(PavState *state, bool connected) {
  if (!state || state->connected == connected) return false;
  state->connected = connected;
  if (!connected) make_uncertain(state);
  return true;
}

bool pav_card_same_run(const PavCard *a, const PavCard *b) {
  return a && b && a->provider[0] && b->provider[0] &&
      !strcmp(a->provider, b->provider) && !strcmp(a->id, b->id);
}

static bool same_source(const uint8_t *p, const PavCard *old) {
  return old->source_state == p[2] && old->source_observed_at == read32(p + 8) &&
      old->source_valid_until == read32(p + 12) &&
      (old->flags & (PAV_PRIVATE | PAV_SHOW_TERMINAL)) ==
      (p[3] & (PAV_PRIVATE | PAV_SHOW_TERMINAL));
}

bool pav_state_receive(PavState *state, const uint8_t *bytes, size_t length,
                       uint32_t now) {
  if (!state) return false;
  if (!pav_decode(bytes, length, NULL)) { make_uncertain(state); return false; }
  if (!state->connected || state->session_token < 2 ||
      read32(bytes + 12) != state->session_token || read32(bytes + 16) <= state->last_sequence)
    return false;
  size_t offset = PAV_HEADER_BYTES;
  for (unsigned i = 0; i < bytes[5]; ++i) {
    const uint8_t *p = bytes + offset;
    for (unsigned j = 0; j < state->snapshot.count; ++j) {
      const PavCard *old = &state->snapshot.items[j];
      const uint8_t *identity = p + PAV_RECORD_HEADER_BYTES;
      if (strlen(old->id) != p[16] ||
          memcmp(old->provider, identity, PAV_PROVIDER_BYTES) ||
          memcmp(old->id, identity + PAV_PROVIDER_BYTES, p[16])) continue;
      const uint32_t revision = read32(p + 4);
      if (revision < old->source_revision ||
          (revision == old->source_revision && !same_source(p, old)) ||
          ((old->source_state == PAV_COMPLETED || old->source_state == PAV_CANCELLED) &&
           (p[2] == PAV_ACTIVE || p[2] == PAV_PAUSED))) return false;
    }
    offset += read16(p);
  }
  if (!pav_decode(bytes, length, &state->snapshot)) return false;
  state->last_sequence = state->snapshot.view_sequence;
  pav_state_prune(state, now);
  return true;
}

uint32_t pav_state_prune(PavState *state, uint32_t now) {
  if (!state) return 0;
  uint32_t next = 0;
  for (unsigned i = 0; i < state->snapshot.count; ++i) {
    PavCard *card = &state->snapshot.items[i];
    if (!card->provider[0]) continue;
    /* Terminal records without a result view retain only their revision
     * identity until the original validity expires. */
    const bool terminal_hidden = (card->source_state == PAV_COMPLETED ||
        card->source_state == PAV_CANCELLED) && !(card->flags & PAV_SHOW_TERMINAL);
    if (card->source_valid_until <= now ||
        (!terminal_hidden && (!datum_visible(card, &card->main, now, state->connected)))) {
      memset(card, 0, sizeof(*card)); continue;
    }
    uint32_t expiry = card->source_valid_until;
    if (!terminal_hidden) {
      if (card->main.valid_until < expiry) expiry = card->main.valid_until;
      if (card->support.type && !datum_visible(card, &card->support, now, state->connected)) {
        memset(&card->support, 0, sizeof(card->support));
        if (card->meter_source) clear_meter(card);
      }
      if (card->support.type && card->support.valid_until < expiry) expiry = card->support.valid_until;
    } else {
      memset(&card->main, 0, sizeof(card->main)); memset(&card->support, 0, sizeof(card->support));
      memset(card->strings, 0, sizeof(card->strings)); memset(card->pixels, 0, sizeof(card->pixels));
      memset(card->palette, 0, sizeof(card->palette));
      card->flags &= (PAV_PRIVATE | PAV_SOURCE_UNCONFIRMED);
      card->width = card->height = 0; card->pixel_bytes = 0; clear_meter(card);
    }
    if (!next || expiry < next) next = expiry;
  }
  return next;
}

const PavCard *pav_state_select(const PavState *state, uint32_t now, unsigned index) {
  if (!state) return NULL;
  for (unsigned i = 0; i < state->snapshot.count; ++i) {
    const PavCard *card = &state->snapshot.items[i];
    if (pav_card_visible(card, now, state->connected)) {
      if (!index) return card;
      --index;
    }
  }
  return NULL;
}

PavClockValue pav_clock_value(const PavCard *card, const PavDatum *datum,
                              uint32_t now, bool connected) {
  PavClockValue result = {0};
  if (!pav_datum_visible(card, datum, now, connected) || datum->type != PAV_CLOCK) return result;
  result.estimated = !connected || (card->flags & PAV_SOURCE_UNCONFIRMED) ||
      (datum->flags & PAV_ESTIMATED) || now < datum->observed_at;
  result.running = (datum->flags & PAV_RUNNING) != 0;
  result.seconds = datum->base_seconds;
  if (result.running) {
    const uint32_t delta = now >= datum->anchor_at ? now - datum->anchor_at : 0;
    if (now < datum->anchor_at) result.estimated = true;
    if (datum->flags & PAV_ELAPSED) {
      const uint64_t seconds = (uint64_t)result.seconds + delta;
      result.seconds = seconds > UINT32_MAX ? UINT32_MAX : (uint32_t)seconds;
    } else {
      result.seconds = delta >= result.seconds ? 0 : result.seconds - delta;
      result.due = result.seconds == 0;
    }
  }
  return result;
}

static const char *pool_text(const PavCard *card, uint16_t offset, uint16_t length) {
  return card && offset < PAV_STRING_BYTES && length < PAV_STRING_BYTES - offset &&
      !card->strings[offset + length] ? card->strings + offset : "";
}

const char *pav_caption(const PavCard *card) {
  return card ? pool_text(card, card->caption_offset, card->caption_length) : "";
}

const char *pav_text(const PavCard *card, const PavDatum *datum) {
  return datum ? pool_text(card, datum->text_offset, datum->text_length) : "";
}

const char *pav_label(const PavCard *card, const PavDatum *datum) {
  return datum ? pool_text(card, datum->label_offset, datum->label_length) : "";
}

bool pav_format_duration(uint32_t seconds, char *buffer, size_t capacity) {
  if (!buffer || !capacity) return false;
  int n;
  if (seconds >= 3600u)
    n = snprintf(buffer, capacity, "%lu:%02lu:%02lu", (unsigned long)(seconds / 3600u),
                 (unsigned long)((seconds / 60u) % 60u), (unsigned long)(seconds % 60u));
  else n = snprintf(buffer, capacity, "%02lu:%02lu", (unsigned long)(seconds / 60u),
                     (unsigned long)(seconds % 60u));
  return n >= 0 && (size_t)n < capacity;
}

bool pav_format_item(const PavCard *card, const PavDatum *datum, uint32_t now,
                     bool connected, char *buffer, size_t capacity) {
  if (!buffer || !capacity) return false;
  buffer[0] = 0;
  if (!pav_datum_visible(card, datum, now, connected)) return false;
  if (datum->type == PAV_CLOCK)
    return pav_format_duration(pav_clock_value(card, datum, now, connected).seconds, buffer, capacity);
  const char *source = pav_text(card, datum);
  const size_t length = strlen(source);
  size_t n = length < capacity ? length : capacity - 1;
  while (n && (((uint8_t)source[n] & 0xc0u) == 0x80u)) --n;
  memcpy(buffer, source, n); buffer[n] = 0;
  return n == length;
}
