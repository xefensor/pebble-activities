#include "../src/c/timer_model.h"

#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  ActivityTimerModel timer;
  activity_timer_init(&timer, 123, 1000);
  assert(activity_timer_valid(&timer));
  assert(timer.run == 0 && timer.revision == 1);
  assert(!activity_timer_start(&timer, 0, 1000));
  assert(activity_timer_start(&timer, 600, 1000));
  assert(timer.run == 1 && timer.deadline == 1600 && timer.observed_at == 1000);
  assert(activity_timer_remaining(&timer, 1120) == 480);
  assert(timer.valid_until >= timer.deadline); /* Not music's 120-second lease. */
  assert(!activity_timer_start(&timer, 60, 1000));

  assert(activity_timer_pause(&timer, 1120));
  uint32_t revision = timer.revision;
  assert(timer.remaining_seconds == 480 && !timer.deadline);
  assert(activity_timer_remaining(&timer, 2000) == 480);
  assert(!activity_timer_pause(&timer, 2000));
  assert(timer.revision == revision);
  assert(activity_timer_extend(&timer, 60, 2000));
  assert(timer.remaining_seconds == 540);
  assert(activity_timer_resume(&timer, 3000));
  assert(timer.deadline == 3540 && timer.remaining_seconds == 0 && timer.run == 1);
  assert(activity_timer_extend(&timer, 60, 3010));
  assert(timer.deadline == 3600 && timer.observed_at == 3010);
  assert(!activity_timer_finish_if_due(&timer, 3599));
  assert(activity_timer_finish_if_due(&timer, 3600));
  assert(timer.state == ACTIVITY_TIMER_FINISHED);
  revision = timer.revision;
  assert(!activity_timer_finish_if_due(&timer, 3601));
  assert(timer.revision == revision); /* Completion is emitted once by owner. */
  assert(activity_timer_valid(&timer));

  /* A restart is another run; delayed receipts cannot acknowledge it. */
  assert(activity_timer_start(&timer, 5, 4000));
  assert(timer.run == 2 && timer.revision > revision);
  assert(activity_timer_cancel(&timer, 4001));
  assert(timer.state == ACTIVITY_TIMER_CANCELLED && !timer.deadline);
  assert(timer.valid_until == 4065); /* Tombstone covers previous running lease. */
  assert(!activity_timer_finish_if_due(&timer, 9000));
  assert(activity_timer_valid(&timer));

  /* Persisted roundtrip has no SDK/phone dependency and retains original times. */
  ActivityTimerModel restored;
  memcpy(&restored, &timer, sizeof(timer));
  assert(activity_timer_valid(&restored));
  assert(restored.observed_at == 4001 && restored.valid_until == 4065);
  assert(activity_timer_reconfirm(&restored, 9000));
  assert(restored.observed_at == 9000 && restored.valid_until == 9060);
  restored.version = 99;
  assert(!activity_timer_valid(&restored));

  activity_timer_init(&timer, 123, 100);
  assert(activity_timer_start(&timer, ACTIVITY_TIMER_MAX_SECONDS, 100));
  assert(!activity_timer_extend(&timer, 1, 100));
  assert(activity_timer_pause(&timer, 101));
  assert(!activity_timer_extend(&timer, ACTIVITY_TIMER_MAX_SECONDS, 101));
  timer.revision = UINT32_MAX;
  assert(!activity_timer_resume(&timer, 102));
  activity_timer_init(&timer, 123, 1000);
  assert(activity_timer_start(&timer, ACTIVITY_TIMER_MAX_SECONDS, 1000));
  assert(activity_timer_reconfirm(&timer, 500));
  assert(activity_timer_valid(&timer));
  assert(timer.observed_at == 1000 && timer.deadline == 87400);
  assert(activity_timer_remaining(&timer, 500) == ACTIVITY_TIMER_MAX_SECONDS);
  memcpy(&restored, &timer, sizeof(timer));
  assert(activity_timer_valid(&restored));
  assert(activity_timer_pause(&timer, 500));
  assert(activity_timer_valid(&timer) && timer.remaining_seconds == ACTIVITY_TIMER_MAX_SECONDS);
  activity_timer_init(&timer, 123, UINT32_MAX - 1);
  assert(!activity_timer_start(&timer, 5, UINT32_MAX - 1));
  assert(sizeof(ActivityTimerModel) <= 256);
  puts("timer model: lifecycle, persistence, expiry and boundary checks passed");
  return 0;
}
