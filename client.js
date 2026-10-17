window.__ModuleLoader__.load({
  id: '@itsyuyi/dsh-approval-sound',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const NS = 'approval-sound';
    const inject = ['slots', 'locale'];
    const CONFIG_ROUTE = '/plugins/approval-sound/config';
    const PLAY_ROUTE = '/plugins/approval-sound/play';

    const zh = {
      tab: '授权提示音',
      intro: '当会话中出现待授权的提示或等待回答的问题时播放系统提示音。修改即时生效。',
      enabled: '总开关',
      enabledHint: '关闭后不再播放任何提示音',
      approvals: '待授权请求',
      approvalsHint: '权限 / 沙箱授权提示出现时响铃',
      questions: '用户问题',
      questionsHint: 'ask_user_question 提示（含计划审批）出现时响铃',
      sound: '提示音',
      soundHint: "'system' 使用系统默认提示音，或填写音频文件绝对路径",
      cooldownMs: '冷却时间（毫秒）',
      cooldownMsHint: '上次响铃后此窗口内的新请求不再重复响铃',
      playTest: '试听',
      playTestDone: '已播放',
      loading: '加载中…',
      saveFailed: '保存失败：',
    };

    const en = {
      tab: 'Approval Sound',
      intro: 'Plays the system notification sound for pending approval or user-question prompts. Changes apply immediately.',
      enabled: 'Master switch',
      enabledHint: 'Turn off to silence every sound',
      approvals: 'Approval requests',
      approvalsHint: 'Ring for permission / sandbox approval prompts',
      questions: 'User questions',
      questionsHint: 'Ring for ask_user_question prompts (incl. plan review)',
      sound: 'Sound',
      soundHint: "'system' for the platform default, or an absolute audio-file path",
      cooldownMs: 'Cooldown (ms)',
      cooldownMsHint: 'New requests inside this window after the last ring stay silent',
      playTest: 'Test sound',
      playTestDone: 'Played',
      loading: 'Loading…',
      saveFailed: 'Save failed: ',
    };

    const CSS = `
      .asnd-panel { display: flex; flex-direction: column; gap: 10px; max-width: 640px; }
      .asnd-intro { margin: 0 0 4px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
      .asnd-row { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
      .asnd-row-main { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
      .asnd-label { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; }
      .asnd-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .asnd-switch { appearance: none; width: 40px; height: 22px; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); position: relative; cursor: pointer; border: none; outline-offset: 2px; flex-shrink: 0; }
      .asnd-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
      .asnd-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
      .asnd-switch[aria-checked="true"]::after { transform: translateX(18px); }
      .asnd-input { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 13px; }
      .asnd-actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
      .asnd-button { padding: 7px 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; cursor: pointer; }
      .asnd-button:hover { border-color: var(--dsw-alias-brand-primary); }
      .asnd-button:disabled { opacity: 0.55; cursor: default; }
      .asnd-feedback { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .asnd-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }
    `;

    let t = (key) => key;

    function Switch({ checked, onChange, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        className: 'asnd-switch',
        onClick: () => onChange(!checked),
      });
    }

    function Panel() {
      const [config, setConfig] = useState(null);
      const [error, setError] = useState(null);
      const [played, setPlayed] = useState(false);
      const timers = useRef(new Set());

      useEffect(() => {
        let cancelled = false;
        fetch(CONFIG_ROUTE, { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!cancelled && data?.ok) setConfig(data.config);
          })
          .catch(() => {
            if (!cancelled) setError(t('saveFailed') + 'GET ' + CONFIG_ROUTE);
          });
        return () => {
          cancelled = true;
          for (const timer of timers.current) clearTimeout(timer);
        };
      }, []);

      const update = (patch, debounceMs = 0) => {
        setConfig((previous) => ({ ...(previous ?? {}), ...patch }));
        const run = () => {
          fetch(CONFIG_ROUTE, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: patch }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data?.ok) setConfig(data.config);
              else setError(t('saveFailed') + (data?.message ?? data?.error ?? ''));
            })
            .catch((err) => setError(t('saveFailed') + String(err)));
        };
        if (debounceMs > 0) {
          const timer = setTimeout(run, debounceMs);
          timers.current.add(timer);
        } else {
          run();
        }
      };

      const testPlay = () => {
        setPlayed(false);
        fetch(PLAY_ROUTE, { method: 'POST' })
          .then((res) => res.json())
          .then((data) => {
            if (data?.ok) setPlayed(true);
            else setError(t('saveFailed') + 'play');
          })
          .catch((err) => setError(t('saveFailed') + String(err)));
      };

      if (config === null) return h('p', { className: 'asnd-feedback' }, t('loading'));

      const rows = [
        { key: 'enabled', label: t('enabled'), hint: t('enabledHint') },
        { key: 'approvals', label: t('approvals'), hint: t('approvalsHint') },
        { key: 'questions', label: t('questions'), hint: t('questionsHint') },
      ];

      return h('div', { className: 'asnd-panel' }, [
        h('style', { key: 'style' }, CSS),
        h('p', { key: 'intro', className: 'asnd-intro' }, t('intro')),
        ...rows.map((row) => h('div', { key: row.key, className: 'asnd-row' }, [
          h('div', { className: 'asnd-row-main' }, [
            h('span', { className: 'asnd-label' }, row.label),
            h(Switch, {
              checked: Boolean(config[row.key]),
              label: row.label,
              onChange: (value) => update({ [row.key]: value }),
            }),
          ]),
          h('span', { className: 'asnd-hint' }, row.hint),
        ])),
        h('div', { className: 'asnd-row' }, [
          h('span', { className: 'asnd-label' }, t('sound')),
          h('input', {
            className: 'asnd-input',
            type: 'text',
            value: config.sound ?? 'system',
            onChange: (event) => update({ sound: event.target.value }, 600),
          }),
          h('span', { className: 'asnd-hint' }, t('soundHint')),
        ]),
        h('div', { className: 'asnd-row' }, [
          h('span', { className: 'asnd-label' }, t('cooldownMs')),
          h('input', {
            className: 'asnd-input',
            type: 'number',
            min: 0,
            step: 100,
            value: config.cooldownMs ?? 1500,
            onChange: (event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) update({ cooldownMs: parsed }, 600);
            },
          }),
          h('span', { className: 'asnd-hint' }, t('cooldownMsHint')),
        ]),
        h('div', { key: 'actions', className: 'asnd-actions' }, [
          h('button', {
            type: 'button',
            className: 'asnd-button',
            onClick: testPlay,
          }, played ? t('playTestDone') : t('playTest')),
          played ? h('span', { className: 'asnd-feedback' }, '✓') : null,
        ]),
        error !== null ? h('p', { key: 'error', className: 'asnd-error' }, error) : null,
      ]);
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'approval-sound: locale dictionaries');
      t = ctx.locale.bind(NS);
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'approval-sound',
        order: 60,
        label: () => t('tab'),
        locale: NS,
      }, Panel));
    }

    return { inject, apply };
  },
});
