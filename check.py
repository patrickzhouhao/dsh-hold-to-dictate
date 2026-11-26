"""Browser regression test for the keyboard adapter; the official recorder is stubbed."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=sys.argv[1] if len(sys.argv) > 1 else None)
    try:
        page = browser.new_page()
        page.route('http://dictation.test/', lambda route: route.fulfill(status=200, content_type='text/html', body=''))
        page.goto('http://dictation.test/')
        page.set_content('''
          <div id="chat">Conversation</div>
          <div id="voice"></div><textarea aria-label="Draft"></textarea>
          <button id="ordinary" onclick="calls.push('ordinary')">Ordinary</button>
          <div id="modal" aria-modal="true" hidden>Modal</div>
          <script>
            window.calls = [];
            window.requesting = false;
            window.result = '你好';
            window.delay = 30;
            window.input = { phase: 'plain', attachmentIds: [], occurrences: [], draft: '', draftRev: 0 };
            const voice = document.querySelector('#voice');
            window.idle = () => {
              voice.innerHTML = '<button aria-label="开始录音">Mic</button>';
              voice.firstChild.onclick = () => {
                calls.push('start');
                voice.innerHTML = `<div data-voice-activity="${requesting ? 'requesting' : 'recording'}">
                  <button aria-label="取消">Cancel</button>
                  ${requesting ? '' : '<button aria-label="停止并识别">Stop</button>'}</div>`;
                voice.querySelector('button').onclick = () => { calls.push('cancel'); idle(); };
                const stop = voice.querySelector('button:nth-child(2)');
                if (stop) stop.onclick = () => {
                  calls.push('stop');
                  const row = voice.firstChild;
                  row.dataset.voiceActivity = 'transcribing';
                  setTimeout(() => {
                    if (!row.isConnected) return;
                    if (result === null || result === '' || result === 'No speech recognized') {
                      row.dataset.voiceActivity = 'feedback';
                      const status = document.createElement('span');
                      status.setAttribute('role', 'status');
                      status.textContent = result === null ? '语音识别失败' : result || '未识别到语音';
                      row.append(status);
                      return;
                    }
                    idle();
                    // Model the official toolbar resetting before the editor publishes.
                    setTimeout(() => { input.draft += result; ++input.draftRev; }, 80);
                  }, delay);
                };
              };
            };
            idle();
            let closeSlot;
            const disposers = [];
            const react = {
              useState: initial => [initial(), () => {}],
              useMemo: fn => fn(),
              useLayoutEffect(fn) { const dispose = fn(); if (dispose) closeSlot = dispose; },
              createElement(tag, {ref, onChange, ...props} = {}, ...children) {
                if (typeof tag === 'function') return tag(props);
                const node = document.createElement(tag);
                Object.assign(node, {checked: props.checked ?? false});
                if (props.className) node.className = props.className;
                if (props.type) node.type = props.type;
                if (props.role) node.setAttribute('role', props.role);
                if (onChange) node.addEventListener('change', event => onChange(event));
                if (ref) ref(node);
                node.append(...children);
                return node;
              },
            };
            window.__ModuleLoader__ = {load(plugin) {
              plugin.factory(() => react).apply({
                locale: {register() {}},
                effect(fn) { const cleanup = fn(); if (cleanup) disposers.push(cleanup); },
                slots: {inject(_name, fn) { fn(); }, register(spec, Component) {
                  if (spec.name !== 'conversation.input.right' || !spec.id) throw new Error('list slot requires options.id');
                  window.mountSlot = sessionId => {
                    closeSlot?.();
                    document.querySelector('.dsh-hold-switch')?.remove();
                    const label = Component({
                      useInput: selector => selector(window.input),
                      inputActions: {
                        captureInsertion: () => ({draftRev: input.draftRev}),
                        submit() { calls.push('send'); input.draft = ''; ++input.draftRev; },
                      },
                      sessionId, t: () => 'Send after dictation',
                    });
                    document.body.append(label);
                  };
                  window.mountSlot('session-test');
                }},
              });
              window.unmountSlot = () => closeSlot();
              window.disposeHotkey = () => disposers.reverse().forEach(fn => fn());
            }};
          </script>
        ''')
        page.evaluate("localStorage.setItem('dsh-hold-to-dictate.auto-send', 'true')")
        page.add_script_tag(path=str(Path(__file__).with_name('client.js')))
        page.locator('#chat').click()
        page.keyboard.down('Space')
        page.keyboard.down('Space')
        assert page.evaluate('calls') == ['start']
        page.keyboard.up('Space')
        assert page.evaluate('calls') == ['start', 'stop']
        assert not page.get_by_role('switch').is_checked()
        page.evaluate("mountSlot('session-new')")
        assert not page.get_by_role('switch').is_checked()

        page.get_by_role('textbox').focus()
        page.keyboard.press('Space')
        assert page.get_by_role('textbox').input_value() == ' '
        page.locator('#ordinary').focus()
        page.keyboard.press('Space')
        assert page.evaluate('calls') == ['start', 'stop', 'ordinary']

        page.locator('#chat').click()
        page.evaluate("document.querySelector('#modal').hidden = false")
        page.keyboard.press('Space')
        assert page.evaluate('calls.length') == 3
        page.evaluate("document.querySelector('#modal').hidden = true; requesting = true")
        page.keyboard.press('Space')
        assert page.evaluate('calls.slice(-2)') == ['start', 'cancel']

        page.evaluate('requesting = false')
        page.keyboard.down('Space')
        page.evaluate("dispatchEvent(new Event('blur'))")
        page.keyboard.up('Space')
        assert page.evaluate('calls.slice(-2)') == ['start', 'cancel']
        toggle = page.get_by_role('switch')
        assert not toggle.is_checked()
        page.wait_for_function("input.draft === '你好'")
        assert 'send' not in page.evaluate('calls')
        page.evaluate("""() => {
          const style = document.documentElement.style;
          style.setProperty('--dsw-alias-border-l3', '#d8dee8');
          style.setProperty('--dsw-alias-brand-primary', '#316be7');
        }""")
        track = page.locator('.dsh-hold-switch-track')
        assert track.evaluate("el => getComputedStyle(el).backgroundColor") == 'rgb(216, 222, 232)'
        page.locator('.dsh-hold-switch').click()
        assert toggle.is_checked()
        assert track.evaluate("el => getComputedStyle(el).backgroundColor") == 'rgb(49, 107, 231)'
        page.evaluate("document.documentElement.style.setProperty('--dsw-alias-brand-primary', '#86abff')")
        assert track.evaluate("el => getComputedStyle(el).backgroundColor") == 'rgb(134, 171, 255)'
        toggle.focus()
        page.keyboard.press('Space')
        assert not toggle.is_checked()
        page.keyboard.press('Space')
        assert toggle.is_checked()
        assert page.evaluate("localStorage.getItem('dsh-hold-to-dictate.auto-send.session.session-new')") == 'true'

        def dictate(text='你好', draft='', attachments=None, delay=30, reset_toolbar=True):
            page.evaluate('([text, draft, attachments, ms, reset]) => { result = text; input.draft = draft; input.attachmentIds = attachments; delay = ms; calls.length = 0; if (reset) idle(); }',
                          [text, draft, attachments or [], delay, reset_toolbar])
            page.locator('#chat').click()
            page.keyboard.press('Space')

        page.evaluate("mountSlot('session-test')")
        assert not toggle.is_checked()
        dictate()
        page.wait_for_function("input.draft === '你好'")
        assert page.evaluate('calls') == ['start', 'stop']
        page.evaluate("mountSlot('session-new')")
        assert toggle.is_checked()
        dictate()
        page.wait_for_function("calls.join(',') === 'start,stop,send'")
        for text, draft, attachments in [('你好', '旧草稿', []), ('你好', '', ['file']), ('/clear', '', []), ('', '', []), (None, '', [])]:
            dictate(text, draft, attachments)
            page.wait_for_timeout(100)
            assert page.evaluate('calls') == ['start', 'stop']
        page.wait_for_timeout(2600)
        assert page.get_by_role('status').inner_text() == '语音识别失败'
        for text, message in [('', '未识别到语音'), ('No speech recognized', 'No speech recognized')]:
            dictate(text)
            page.get_by_text(message, exact=True).wait_for()
            page.get_by_text(message, exact=True).wait_for(state='detached', timeout=1400)
            assert page.evaluate('calls') == ['start', 'stop', 'cancel']
            assert toggle.is_checked()
            dictate(reset_toolbar=False)
            page.wait_for_function("calls.join(',') === 'start,stop,send'")
        dictate(delay=150)
        page.keyboard.press('Escape')
        page.wait_for_timeout(200)
        assert page.evaluate('calls') == ['start', 'stop']
        dictate(delay=150)
        page.evaluate('unmountSlot()')
        page.wait_for_timeout(200)
        assert page.evaluate('calls') == ['start', 'stop']
        page.evaluate('disposeHotkey()')
        page.keyboard.press('Space')
        assert page.evaluate('calls') == ['start', 'stop']
        print('Pass: keyboard regression, default off, persistent setting, send once, and unsafe sends prevented')
    finally:
        browser.close()
