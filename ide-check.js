const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 2) console.log('CONSOLE[' + level + '] ' + msg);
  });
  await win.loadFile('index.html');
  await new Promise((r) => setTimeout(r, 1500));
  const res = await win.webContents.executeJavaScript(\(async () => {
    const out = [];
    const t = (n, f) => Promise.resolve().then(f)
      .then(() => out.push('ok  ' + n)).catch((e) => out.push('FAIL ' + n + ': ' + e.message));

    await t('IDE page exists and navigates', () => {
      navigate('ide');
      if (!document.getElementById('page-ide').classList.contains('active')) throw new Error('page not active');
      ['ideOpenFolder','ideTree','ideEditor','ideTask','ideRun','ideSteps','ideConsole'].forEach((id) => {
        if (!document.getElementById(id)) throw new Error(id + ' missing');
      });
      if (typeof IDE_AGENT !== 'object' || typeof IDE_AGENT.runAgent !== 'function') throw new Error('IDE_AGENT not loaded');
    });

    await t('folder opens and tree renders + file opens', () => {
      ideRoot = ;
      document.getElementById('ideRoot').textContent = ideRoot;
      renderTree();
      const rows = [...document.querySelectorAll('#ideTree .ide-tree-row')];
      if (!rows.length) throw new Error('tree empty');
      const readme = rows.find((r) => r.textContent.includes('readme.txt'));
      if (!readme) throw new Error('readme.txt not listed: ' + rows.map(r=>r.textContent).join(','));
      readme.click();
      if (!document.getElementById('ideEditor').value.includes('existing project file')) throw new Error('file not opened');
    });

    await t('agent loop drives the UI end-to-end (scripted model)', async () => {
      // scripted model: write a file, then done — no network needed
      const replies = [
        '{"tool":"write_file","path":"agent-note.txt","content":"hello from the agent"}',
        '{"tool":"read_file","path":"agent-note.txt"}',
        '{"tool":"done","summary":"created and verified agent-note.txt"}'
      ];
      const tools = IDE_AGENT.createTools(ideRoot);
      const events = [];
      const result = await IDE_AGENT.runAgent({
        callModel: async () => replies.shift(),
        tools,
        systemPrompt: IDE_AGENT.buildSystemPrompt(ideRoot),
        task: 'create a note',
        maxSteps: 6,
        onEvent: (ev) => events.push(ev.type),
      });
      if (!result.done) throw new Error('not done: ' + result.reason);
      if (result.steps < 2) throw new Error('too few steps');
      const expect = ['model','tool','model','tool','model','done'];
      if (JSON.stringify(events) !== JSON.stringify(expect)) throw new Error('event order ' + JSON.stringify(events));
      if (!require('fs').existsSync(ideRoot + '/agent-note.txt')) throw new Error('file not written');
    });

    await t('agent action shows in UI panels after a real runAgent call', async () => {
      document.getElementById('ideSteps').innerHTML = '';
      const replies = ['{"tool":"write_file","path":"ui-note.txt","content":"ui"}', '{"tool":"done","summary":"ui ok"}'];
      await IDE_AGENT.runAgent({
        callModel: async () => replies.shift(),
        tools: IDE_AGENT.createTools(ideRoot),
        systemPrompt: IDE_AGENT.buildSystemPrompt(ideRoot),
        task: 'ui test', maxSteps: 4,
        onEvent: (ev) => {
          if (ev.type === 'tool') ideStep('<b>tool</b> ' + ev.action.tool);
          if (ev.type === 'done') ideStep('<b>done</b>');
        },
      });
      if (!document.querySelectorAll('#ideSteps .ide-step').length) throw new Error('steps not rendered');
    });

    return out;
  })()\);
  console.log('IDE-CHECK\n' + res.join('\n'));
  app.exit(res.some(r => r.startsWith('FAIL')) ? 1 : 0);
});
