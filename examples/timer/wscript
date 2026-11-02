top = '.'
out = 'build'

from os import environ

from waflib.TaskGen import after_method, feature

@feature('message_keys')
@after_method('process_message_keys')
def message_key_cache_inputs(task_gen):
    # Include generated keys in the Waf 2 cache signature (SDK 4.33.1).
    for task in task_gen.tasks:
        if hasattr(task, 'message_keys') and 'MESSAGE_KEYS' not in task.vars:
            task.vars = list(task.vars) + ['MESSAGE_KEYS']

def options(ctx):
    ctx.load('pebble_sdk')

def configure(ctx):
    ctx.load('pebble_sdk')

def build(ctx):
    ctx.load('pebble_sdk')
    cached_env = ctx.env
    binaries = []
    for platform in ctx.env.TARGET_PLATFORMS:
        ctx.env = ctx.all_envs[platform]
        # Opt-in local alarm investigation; release builds stay silent.
        if environ.get('ACTIVITY_TIMER_DIAGNOSTICS') == '1':
            ctx.env.append_unique('DEFINES', 'ACTIVITY_TIMER_DIAGNOSTICS=1')
        else:
            ctx.env.DEFINES = [value for value in ctx.env.DEFINES
                               if value != 'ACTIVITY_TIMER_DIAGNOSTICS=1']
        ctx.set_group(ctx.env.PLATFORM_NAME)
        app_elf = '{}/pebble-app.elf'.format(ctx.env.BUILD_DIR)
        ctx.pbl_build(source=ctx.path.ant_glob('src/c/**/*.c'), target=app_elf, bin_type='app')
        binaries.append({'platform': platform, 'app_elf': app_elf})
    ctx.env = cached_env
    ctx.set_group('bundle')
    ctx.pbl_bundle(binaries=binaries, js=ctx.path.ant_glob('src/pkjs/**/*.js'),
                   js_entry_file='src/pkjs/index.js')
