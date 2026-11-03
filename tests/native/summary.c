#include "pebble-activity-view.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t load(const char *directory, const char *name, uint8_t *packet) {
  char path[1024]; snprintf(path, sizeof(path), "%s/%s.bin", directory, name);
  FILE *file=fopen(path,"rb");assert(file);size_t n=fread(packet,1,PAV_MAX_PACKET_BYTES,file);assert(!ferror(file));assert(fgetc(file)==EOF);fclose(file);return n;
}
static void put16(uint8_t *p,unsigned v){p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8);}
static void checksum(uint8_t *p,size_t n){put16(p+8,pav_packet_crc16(p,n));}
static void reject(uint8_t *packet,size_t n){PavSnapshot before,after;memset(&before,0xa5,sizeof(before));after=before;assert(!pav_decode(packet,n,&after));assert(!memcmp(&before,&after,sizeof(before)));}
int main(int argc,char **argv){
  assert(argc==2);uint8_t packet[PAV_MAX_PACKET_BYTES],saved[PAV_MAX_PACKET_BYTES];PavSnapshot decoded;
  size_t n=load(argv[1],"summary-clock",packet);assert(pav_decode(packet,n,&decoded));
  assert(decoded.wire_version==3&&decoded.count==1);PavCard *card=&decoded.items[0];
  assert(card->presentation==PAV_PRESENTATION_CLOCK&&card->identity_symbol==PAV_SYMBOL_TIMER&&card->compact_item==1);
  assert(!pav_label(card,&card->main)[0]);assert(!strcmp(pav_caption(card),"Tea"));
  assert(!strcmp(pav_qualifier(card),"Tea"));assert(card->source_state==PAV_PAUSED);
  assert(pav_clock_value(card,&card->main,110,true).seconds==50);
  assert(pav_clock_value(card,&card->support,110,true).seconds==50);
  PavState state;pav_state_init(&state,17,true);assert(pav_state_receive(&state,packet,n,100));assert(pav_state_select(&state,101,0));
  memcpy(saved,packet,n);for(size_t i=0;i<n;i++)reject(packet,i);
  const unsigned offsets[]={88,89,90,91,92,96};const uint8_t values[]={6,11,2,64,255,1};
  for(unsigned i=0;i<sizeof(offsets)/sizeof(offsets[0]);i++){packet[24+offsets[i]]=values[i];checksum(packet,n);reject(packet,n);memcpy(packet,saved,n);}
  n=load(argv[1],"summary-direction",packet);assert(pav_decode(packet,n,&decoded));card=&decoded.items[0];
  assert(card->presentation==PAV_PRESENTATION_RANGED&&card->compact_item==1);
  assert(card->directions[0]==PAV_DIRECTION_RIGHT&&card->directions[1]==PAV_DIRECTION_LEFT);
  assert(!strcmp(pav_text(card,&card->main),"200 m"));assert(!strcmp(pav_text(card,&card->support),"80 m"));
  assert(card->meter>13000&&card->meter<13120);
  n=load(argv[1],"summary-media",packet);assert(pav_decode(packet,n,&decoded));card=&decoded.items[0];
  assert(card->presentation==PAV_PRESENTATION_MEDIA&&card->identity_symbol==PAV_SYMBOL_MEDIA&&(card->flags&PAV_PRIVATE));
  assert(!strcmp(pav_text(card,&card->main),"A song"));assert(!strcmp(pav_text(card,&card->support),"Artist"));
  assert(card->visual_token[0]||card->visual_token[1]||card->visual_token[2]||card->visual_token[3]);
  pav_state_init(&state,17,true);assert(pav_state_receive(&state,packet,n,100));assert(pav_state_set_connected(&state,false));assert(!pav_state_select(&state,101,0));
  n=load(argv[1],"summary-max",packet);assert(n==2672);assert(pav_decode(packet,n,&decoded));assert(decoded.count==2);assert(decoded.items[0].pixel_bytes==800);
  puts("ACT3 cross-language, bounds, semantic metadata and privacy checks passed");return 0;
}
