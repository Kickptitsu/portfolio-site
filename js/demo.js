/*
  Демо-чат: имитация окна Telegram по заранее записанному сценарию.
  Никаких подключений к ботам и ИИ — всё берётся из JSON-файлов в папке demos/.
  Как устроен сценарий и как добавить новый проект — demos/README.md.
*/
(() => {
  'use strict';

  const root = document.getElementById('demo-app');
  if (!root) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (selector) => root.querySelector(selector);
  const ui = {
    tabs: $('.demo-tabs'),
    info: $('.demo-info'),
    avatar: $('.tg-avatar'),
    name: $('.tg-name'),
    status: $('.tg-status'),
    restart: $('.tg-restart'),
    toast: $('.tg-toast'),
    log: $('.tg-log'),
    suggest: $('.tg-suggest'),
    chips: $('.tg-chips'),
    placeholder: $('.tg-placeholder'),
    keyboard: $('.tg-keyboard'),
  };

  const DEFAULT_PLACEHOLDER = 'Сообщение';
  const DEFAULT_INACTIVE = 'В демо эта кнопка не работает — попробуйте другую';

  let scenarios = [];     // список из demos/index.json
  const loaded = {};      // уже скачанные сценарии, чтобы не качать повторно
  let scenario = null;    // сценарий, который сейчас открыт
  let vars = {};          // переменные сценария: сколько товаров в корзине, итог и т. п.
  let run = 0;            // номер запуска: «Сначала» отменяет недоигранные паузы
  let busy = false;       // бот «печатает» — нажатия пока не принимаем
  let toastTimer = 0;

  // ---------- Вспомогательное ----------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // «Печатает…» тем дольше, чем длиннее сообщение, но не дольше полутора секунд
  const typingTime = (text) => (reduceMotion ? 150 : Math.min(450 + text.length * 8, 1500));

  // Подставляет переменные: «Итого: {total}» -> «Итого: 440 ₽»
  const fill = (text) =>
    String(text ?? '').replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));

  const escapeHtml = (text) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Разметка в текстах сценария: **жирный**, `код`, перенос строки
  const format = (text) =>
    escapeHtml(fill(text))
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

  // Клавиатуру и подсказки можно задать прямо в шаге или по имени из общего списка
  const pick = (value, dictionary) => (typeof value === 'string' ? (dictionary || {})[value] : value);

  function applySet(set) {
    for (const [key, value] of Object.entries(set)) vars[key] = fill(value);
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function scrollDown() {
    // Прокручиваем только окно чата, а не всю страницу
    ui.log.scrollTo({ top: ui.log.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2400);
  }

  function setTyping(on) {
    ui.status.textContent = on ? 'печатает…' : scenario.bot.status || 'бот';
    ui.status.classList.toggle('is-typing', on);
    root.classList.toggle('is-busy', on);
  }

  // ---------- Сообщения и кнопки ----------

  function makeButton(button, kind, messageNode) {
    const node = make('button', kind === 'chip' ? 'tg-chip' : 'tg-btn', fill(button.text));
    node.type = 'button';
    node.addEventListener('click', () => press(button, kind, messageNode, node));
    return node;
  }

  function fillMessage(node, message) {
    node.textContent = '';
    const bubble = make('div', 'tg-bubble');
    bubble.innerHTML = format(message.text || '');
    node.append(bubble);

    if (message.buttons) {
      // Работают только кнопки самого свежего сообщения — так сценарий не запутается
      ui.log.querySelectorAll('.tg-inline').forEach((kb) => kb.classList.add('is-stale'));
      const keyboard = make('div', 'tg-inline');
      for (const row of message.buttons) {
        const rowNode = make('div', 'tg-row');
        for (const button of row) rowNode.append(makeButton(button, 'inline', node));
        keyboard.append(rowNode);
      }
      node.append(keyboard);
    }
  }

  function addMessage(message) {
    const node = make('div', `tg-msg tg-from-${message.from || 'bot'}`);
    fillMessage(node, message);
    ui.log.append(node);
    scrollDown();
    return node;
  }

  function renderKeyboard(rows) {
    ui.keyboard.textContent = '';
    ui.keyboard.hidden = !rows || !rows.length;
    for (const row of rows || []) {
      const rowNode = make('div', 'tg-row');
      for (const button of row) rowNode.append(makeButton(button, 'reply'));
      ui.keyboard.append(rowNode);
    }
  }

  function renderSuggest(list) {
    ui.chips.textContent = '';
    ui.suggest.hidden = !list || !list.length;
    for (const button of list || []) ui.chips.append(makeButton(button, 'chip'));
  }

  // ---------- Сценарий ----------

  // Нажатие любой кнопки: inline под сообщением, кнопки внизу или подсказки
  async function press(button, kind, messageNode, buttonNode) {
    if (busy || buttonNode.closest('.is-stale')) return;

    if (button.set) applySet(button.set);
    const next = button.next ? fill(button.next) : null;
    if (!next || !scenario.steps[next]) {
      if (next) console.warn(`Демо: в сценарии нет шага «${next}»`);
      showToast(fill(button.toast || scenario.inactive || DEFAULT_INACTIVE));
      return;
    }

    // Кнопки внизу и подсказки отправляют текст от имени клиента, inline-кнопки — нет
    if (kind !== 'inline') addMessage({ from: 'user', text: button.say || button.text });
    await go(next, kind === 'inline' ? messageNode : null);
  }

  // Показ одного шага: сообщения бота по очереди, потом кнопки
  async function go(stepId, pressedMessage) {
    const myRun = run;
    const step = scenario.steps[stepId];
    busy = true;
    try {
      if (step.set) applySet(step.set);
      if (step.toast) showToast(fill(step.toast));

      const messages = step.messages || [];
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const from = message.from || 'bot';
        const editing = i === 0 && step.edit && pressedMessage && pressedMessage.isConnected;

        if (editing) {
          await sleep(reduceMotion ? 0 : 250);
        } else if (from === 'bot') {
          setTyping(true);
          await sleep(typingTime(fill(message.text)));
        } else if (from === 'service') {
          await sleep(reduceMotion ? 100 : 500);
        }
        if (myRun !== run) return;   // нажали «Сначала» — этот показ больше не нужен
        setTyping(false);

        if (editing) {
          // Бот правит то же сообщение, а не присылает новое — как настоящий
          fillMessage(pressedMessage, message);
          pressedMessage.classList.remove('is-edited');
          void pressedMessage.offsetWidth;  // перезапуск подсветки
          pressedMessage.classList.add('is-edited');
          scrollDown();
        } else {
          addMessage(message);
        }
      }

      if ('keyboard' in step) renderKeyboard(pick(step.keyboard, scenario.keyboards));
      if ('suggest' in step) renderSuggest(pick(step.suggest, scenario.suggestions));
      if ('placeholder' in step) ui.placeholder.textContent = step.placeholder || DEFAULT_PLACEHOLDER;

      // Следующий шаг без нажатия: например, менеджер сменил статус заказа
      if (step.auto && scenario.steps[fill(step.auto)]) {
        await sleep(reduceMotion ? 300 : step.autoDelay || 1500);
        if (myRun !== run) return;
        await go(fill(step.auto), null);
      }
    } finally {
      if (myRun === run) {
        busy = false;
        setTyping(false);
      }
    }
  }

  function restart() {
    run++;
    busy = false;
    vars = { ...(scenario.vars || {}) };
    ui.log.textContent = '';
    ui.placeholder.textContent = DEFAULT_PLACEHOLDER;
    renderKeyboard(null);
    renderSuggest(null);
    setTyping(false);
    ui.toast.hidden = true;
    go(scenario.start);
  }

  // Подсказка автору сценария: кнопки, ведущие в несуществующие шаги, — в консоли браузера
  function check(data) {
    const all = [];
    const collect = (rows) => (rows || []).forEach((row) => (Array.isArray(row) ? all.push(...row) : all.push(row)));
    Object.values(data.keyboards || {}).forEach(collect);
    Object.values(data.suggestions || {}).forEach(collect);
    for (const step of Object.values(data.steps)) {
      (step.messages || []).forEach((m) => collect(m.buttons));
      if (typeof step.keyboard === 'object') collect(step.keyboard);
      if (typeof step.suggest === 'object') collect(step.suggest);
    }
    for (const button of all) {
      if (button.next && !button.next.includes('{') && !data.steps[button.next]) {
        console.warn(`Демо: кнопка «${button.text}» ведёт в шаг «${button.next}», которого нет`);
      }
    }
    if (!data.steps[data.start]) console.warn(`Демо: нет стартового шага «${data.start}»`);
  }

  // ---------- Выбор сценария ----------

  function renderInfo(about) {
    ui.info.textContent = '';
    if (!about) return;
    ui.info.append(make('h3', null, about.title));
    if (about.text) ui.info.append(make('p', null, about.text));
    if (about.try && about.try.length) {
      ui.info.append(make('p', 'demo-try-label', 'Что попробовать'));
      const list = make('ul', 'check-list');
      for (const item of about.try) list.append(make('li', null, item));
      ui.info.append(list);
    }
  }

  let opening = 0;   // если быстро переключить вкладки, откроется последняя нажатая

  async function open(id) {
    const entry = scenarios.find((s) => s.id === id);
    if (!entry) return;
    const myOpening = ++opening;

    for (const tab of ui.tabs.children) tab.setAttribute('aria-selected', String(tab.dataset.id === id));

    try {
      if (!loaded[id]) {
        const response = await fetch(`demos/${entry.file}`);
        if (!response.ok) throw new Error(response.status);
        loaded[id] = await response.json();
        check(loaded[id]);
      }
    } catch (error) {
      console.error('Демо: не удалось загрузить сценарий', error);
      ui.log.textContent = '';
      addMessage({ from: 'service', text: 'Не удалось загрузить демо. Обновите страницу.' });
      return;
    }
    if (myOpening !== opening) return;

    scenario = loaded[id];
    ui.avatar.textContent = scenario.bot.avatar || '🤖';
    ui.name.textContent = scenario.bot.name;
    renderInfo(scenario.about);
    restart();
  }

  async function init(firstId) {
    try {
      const response = await fetch('demos/index.json');
      if (!response.ok) throw new Error(response.status);
      scenarios = (await response.json()).scenarios;
    } catch (error) {
      console.error('Демо: не удалось загрузить demos/index.json', error);
      addMessage({
        from: 'service',
        text: 'Не удалось загрузить демо. Если сайт открыт как файл, запустите его через веб-сервер.',
      });
      return;
    }

    for (const entry of scenarios) {
      const tab = make('button', 'demo-tab', entry.tab);
      tab.type = 'button';
      tab.dataset.id = entry.id;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => open(entry.id));
      ui.tabs.append(tab);
    }

    ui.restart.addEventListener('click', () => scenario && restart());

    await open(firstId || scenarios[0].id);
  }

  // Сценарии скачиваем, только когда посетитель долистал почти до демо:
  // первый экран открывается быстрее, а тем, кто до демо не дошёл, файлы не нужны
  let started = null;
  const start = (firstId) => started || (started = init(firstId));

  // Кнопки «Попробовать демо» в карточках проектов сразу открывают нужный сценарий
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-demo]');
    if (!link) return;
    if (started) open(link.dataset.demo);
    else start(link.dataset.demo);
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(root);
  } else {
    start();
  }
})();
