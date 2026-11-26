window.__ModuleLoader__.load({
  id: '@local/dsh-hold-to-dictate',
  factory(require) {
    const React = require('react')
    const controls = 'conversation.input.right'
    const namespace = 'hold-to-dictate'
    const switchCss = `
      .dsh-hold-switch {
        display: inline-flex; align-items: center; gap: 6px; position: relative;
        box-sizing: border-box; min-height: 28px; padding: 0 7px;
        border-radius: 7px; cursor: pointer; white-space: nowrap;
        color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px;
      }
      .dsh-hold-switch:hover { background: var(--dsw-alias-border-l3); }
      .dsh-hold-switch:has(input:focus-visible) {
        outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
        outline-offset: 2px;
      }
      .dsh-hold-switch input {
        position: absolute; width: 1px; height: 1px; margin: 0;
        clip-path: inset(50%);
      }
      .dsh-hold-switch-track {
        display: inline-flex; align-items: center; flex: none; width: 26px; height: 15px;
        padding: 2px; box-sizing: border-box; border-radius: 999px; corner-shape: round;
        background: var(--dsw-alias-border-l3);
      }
      .dsh-hold-switch-track::before {
        content: ''; width: 11px; height: 11px; border-radius: 50%; corner-shape: round;
        background: var(--dsw-alias-switch-thumb);
      }
      .dsh-hold-switch input:checked + .dsh-hold-switch-track { background: var(--dsw-alias-brand-primary); }
      .dsh-hold-switch input:checked + .dsh-hold-switch-track::before {
        transform: translateX(11px); background: var(--dsw-alias-label-primary-foreground);
      }
      @media (prefers-reduced-motion: no-preference) {
        .dsh-hold-switch-track::before { transition: transform 120ms ease; }
      }
      @media (forced-colors: active) {
        .dsh-hold-switch-track { border: 1px solid ButtonText; }
        .dsh-hold-switch-track::before { background: ButtonText !important; }
        .dsh-hold-switch input:checked + .dsh-hold-switch-track { border-color: Highlight; }
      }
    `
    // Separate keys deliberately ignore the old profile-wide opt-in.
    const storageKey = sessionId => `dsh-hold-to-dictate.auto-send.session.${sessionId}`
    function readAutoSend(sessionId) {
      if (!sessionId) return false
      try { return localStorage.getItem(storageKey(sessionId)) === 'true' } catch { return false }
    }
    // ponytail: rc.5 exposes no recording actions or success event. Reuse the
    // official controls and require both toolbar completion and a fresh draft.
    const start = 'button[aria-label="开始录音"], button[aria-label="Start recording"]'
    const activity = '[data-voice-activity]'
    const stop = 'button[aria-label="停止并识别"], button[aria-label="Stop and transcribe"]'
    const cancel = 'button[aria-label="取消"], button[aria-label="Cancel"]'
    const modal = '[aria-modal="true"], dialog[open]'
    const interactive = 'input, textarea, select, [contenteditable], button, a[href], [role="button"], [role="textbox"], [role="combobox"], [role="menuitem"], [role="slider"], [role="checkbox"], [role="switch"], [role="tab"], [role="radio"]'

    function oneVisible(root, selector) {
      const matches = [...root.querySelectorAll(selector)].filter(element =>
        element.getClientRects().length !== 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]'))
      return matches.length === 1 ? matches[0] : undefined
    }
    const clean = input => input?.phase === 'plain' && input.attachmentIds.length === 0 && input.occurrences.length === 0

    function apply(ctx) {
      let composer
      let forget = () => {}

      function AutoSend(props) {
        if (!props.sessionId) return null
        return React.createElement(SessionAutoSend, { ...props, key: props.sessionId })
      }

      function SessionAutoSend({ useInput, inputActions, sessionId, t }) {
        const input = useInput(state => state)
        const [enabled, setEnabled] = React.useState(() => readAutoSend(sessionId))
        const entry = React.useMemo(() => ({ inputActions, input: undefined, element: undefined, enabled: false }), [inputActions, sessionId])
        React.useLayoutEffect(() => {
          composer = entry
          entry.enabled = enabled
          return () => { if (composer === entry) { forget(); composer = undefined } }
        }, [entry])
        React.useLayoutEffect(() => { entry.input = input }, [entry, input])
        return React.createElement('label', {
          ref: element => { entry.element = element },
          className: 'dsh-hold-switch',
        }, React.createElement('input', {
          type: 'checkbox', role: 'switch', checked: enabled,
          onChange: event => {
            entry.enabled = event.currentTarget.checked
            forget()
            setEnabled(entry.enabled)
            try { localStorage.setItem(storageKey(sessionId), String(entry.enabled)) } catch { /* for this mount only */ }
          },
        }), React.createElement('span', { className: 'dsh-hold-switch-track', 'aria-hidden': true }),
        t('autoSend'), React.createElement('style', {}, switchCss))
      }
      ctx.effect(() => ctx.locale.register(namespace, {
        zh: { autoSend: '听写后自动发送' }, en: { autoSend: 'Send after dictation' },
      }))
      ctx.slots.inject(controls, () => ctx.slots.register({ name: controls, id: namespace, locale: namespace }, AutoSend))

      ctx.effect(() => {
        let held
        let dismissTimer
        let emptyRow
        const emptyFeedback = `${activity}[data-voice-activity="feedback"]`
        function isEmptyFeedback(row) {
          if (!row?.isConnected || !row.matches(emptyFeedback)) return false
          const message = row.querySelector('[role="status"]')?.textContent.trim()
          return message === '未识别到语音' || message === 'No speech recognized'
        }
        // ponytail: the official toolbar has no typed feedback event. Match only
        // the empty-transcript message; errors and recoverable drafts stay visible.
        const feedbackObserver = new MutationObserver(() => {
          const row = oneVisible(document, emptyFeedback)
          const next = isEmptyFeedback(row) ? row : undefined
          if (next === emptyRow) return
          clearTimeout(dismissTimer)
          emptyRow = next
          if (!next) return
          dismissTimer = setTimeout(() => {
            if (isEmptyFeedback(next) && oneVisible(document, emptyFeedback) === next) {
              oneVisible(next, cancel)?.click()
            }
          }, 1000)
        })
        feedbackObserver.observe(document.body, {
          subtree: true, childList: true, characterData: true,
          attributes: true, attributeFilter: ['data-voice-activity'],
        })
        let disposeWait
        forget = () => { if (held) held.auto = undefined; disposeWait?.() }

        function sendWhenTranscribed(row, snapshot) {
          if (!snapshot) return
          let transcribing = false
          let frame
          const observer = new MutationObserver(() => {
            const phase = row.getAttribute('data-voice-activity')
            if (phase === 'transcribing') transcribing = true
            if (phase === 'feedback') { dispose(); return }
            if (row.isConnected) return
            observer.disconnect()
            if (!transcribing) { dispose(); return }
            const deadline = performance.now() + 750
            function submitWhenDraftReady() {
              if (!snapshot.entry.enabled || document.hidden || !document.hasFocus() || oneVisible(document, modal) ||
                  composer !== snapshot.entry || !composer.element?.isConnected) { dispose(); return }
              const input = composer.input
              const revision = composer.inputActions.captureInsertion().draftRev
              const expected = snapshot.revision + 1
              if (!clean(input) || revision > expected || input.draftRev > expected) { dispose(); return }
              // The toolbar can disappear before the editor and its slot publish the new draft.
              if (revision < expected || input.draftRev < expected || !oneVisible(document, start)) {
                if (performance.now() < deadline) frame = requestAnimationFrame(submitWhenDraftReady)
                else dispose()
                return
              }
              dispose()
              if (input.draft.trim() && !input.draft.trimStart().startsWith('/')) composer.inputActions.submit()
            }
            frame = requestAnimationFrame(submitWhenDraftReady)
          })
          const timeout = setTimeout(() => dispose(), 120_000)
          function dispose() {
            observer.disconnect()
            clearTimeout(timeout)
            if (frame !== undefined) cancelAnimationFrame(frame)
            if (disposeWait === dispose) disposeWait = undefined
          }
          disposeWait = dispose
          observer.observe(row, { attributes: true, attributeFilter: ['data-voice-activity'] })
          observer.observe(document.body, { childList: true, subtree: true })
        }

        function release(finish) {
          if (!held) return
          const { auto } = held
          held = undefined
          const row = oneVisible(document, activity)
          if (!row) return
          const phase = row.getAttribute('data-voice-activity')
          if (phase !== 'recording' && phase !== 'requesting') return
          if (finish && phase === 'recording') {
            const button = oneVisible(row, stop)
            if (!button) return
            sendWhenTranscribed(row, auto)
            button.click()
          } else oneVisible(row, cancel)?.click()
        }
        function keydown(event) {
          if (event.code !== 'Space') { forget(); return }
          if (held) { event.preventDefault(); return }
          forget()
          if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
              event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || document.hidden ||
              event.composedPath().some(node => node instanceof Element &&
                (node.isContentEditable || node.closest(interactive))) ||
              oneVisible(document, modal) || oneVisible(document, activity)) return
          const button = oneVisible(document, start)
          if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return
          event.preventDefault()
          const input = composer?.input
          held = { auto: composer?.enabled && composer.element?.isConnected && clean(input) && input.draft === ''
            ? { entry: composer, revision: input.draftRev } : undefined }
          button.click()
        }
        function keyup(event) {
          if (event.code !== 'Space' || !held) return
          event.preventDefault()
          release(true)
        }
        const abort = () => { forget(); release(false) }
        const visibility = () => { if (document.hidden) abort() }
        window.addEventListener('keydown', keydown)
        window.addEventListener('keyup', keyup, true)
        window.addEventListener('blur', abort)
        document.addEventListener('visibilitychange', visibility)
        for (const type of ['pointerdown', 'beforeinput', 'input', 'drop', 'paste']) window.addEventListener(type, forget, true)
        return () => {
          window.removeEventListener('keydown', keydown)
          window.removeEventListener('keyup', keyup, true)
          window.removeEventListener('blur', abort)
          document.removeEventListener('visibilitychange', visibility)
          for (const type of ['pointerdown', 'beforeinput', 'input', 'drop', 'paste']) window.removeEventListener(type, forget, true)
          feedbackObserver.disconnect()
          clearTimeout(dismissTimer)
          abort()
        }
      })
    }
    return { inject: ['slots', 'locale'], apply }
  },
})
