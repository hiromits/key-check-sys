// ES modules import
const { render, Component } = preact;
const html = htm.bind(preact.createElement);

// データ管理クラス
class DataManager {
  constructor() {
    this.storageKey = 'lockCheckData';
    this.initializeData();
  }

  initializeData() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      this.data = {
        records: {},
        settings: {
          theme: 'light',
          notifications: true
        }
      };
      this.save();
    } else {
      try {
        this.data = JSON.parse(stored);
      } catch (e) {
        console.error('データ読み込みエラー:', e);
        this.data = { records: {}, settings: { theme: 'light', notifications: true } };
      }
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch (e) {
      console.error('データ保存エラー:', e);
    }
  }

  getTodayRecord() {
    const today = this.getDateKey();
    return this.data.records[today] || {
      date: today,
      mainLock: false,
      barLock: false,
      completed: false,
      timestamp: null
    };
  }

  updateLockState(lockType, state) {
    const today = this.getDateKey();
    if (!this.data.records[today]) {
      this.data.records[today] = {
        date: today,
        mainLock: false,
        barLock: false,
        completed: false,
        timestamp: null,
        lockTimestamp: null,
        pointsAwarded: false
      };
    }
    
    this.data.records[today][lockType] = state;
    
    // ロック時刻を記録
    if (state) {
      this.data.records[today].lockTimestamp = new Date().toISOString();
    }
    
    this.data.records[today].timestamp = new Date().toISOString();
    
    // 両方ロックされた場合は完了状態を更新
    const record = this.data.records[today];
    record.completed = record.mainLock && record.barLock;
    
    this.save();
    return this.data.records[today];
  }

  // 30分経過チェックとリセット
  checkAndResetLocks() {
    const today = this.getDateKey();
    const todayRecord = this.data.records[today];
    
    if (todayRecord && todayRecord.lockTimestamp) {
      const lockTime = new Date(todayRecord.lockTimestamp);
      const now = new Date();
      const thirtyMinutes = 30 * 60 * 1000; // 30分をミリ秒で
      
      if (now - lockTime > thirtyMinutes) {
        // 30分経過したのでリセット
        todayRecord.mainLock = false;
        todayRecord.barLock = false;
        todayRecord.completed = false;
        todayRecord.lockTimestamp = null;
        this.save();
        return true; // リセットされた
      }
    }
    return false; // リセットされていない
  }

  // 完了処理とポイント付与
  completeToday() {
    const today = this.getDateKey();
    if (!this.data.records[today]) return null;
    
    const record = this.data.records[today];
    
    // 既にポイントが付与されていたら何もしない
    if (record.pointsAwarded) {
      return { alreadyAwarded: true, points: 0 };
    }
    
    // 両方ロックされていて、まだポイントが付与されていない場合のみ
    if (record.completed && !record.pointsAwarded) {
      record.pointsAwarded = true;
      this.save();
      return { alreadyAwarded: false, points: this.calculatePoints() };
    }
    
    return null;
  }

  calculatePoints() {
    const streak = this.calculateStreak();
    const basePoints = 10;
    const streakBonus = Math.min(streak * 2, 50);
    return basePoints + streakBonus;
  }

  getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getRecordsForMonth(year, month) {
    const records = {};
    Object.keys(this.data.records).forEach(dateKey => {
      const date = new Date(dateKey);
      if (date.getFullYear() === year && date.getMonth() === month) {
        records[dateKey] = this.data.records[dateKey];
      }
    });
    return records;
  }

  clearData() {
    this.data = { records: {}, settings: this.data.settings };
    this.save();
  }

  updateSettings(newSettings) {
    this.data.settings = { ...this.data.settings, ...newSettings };
    this.save();
  }

  addPoints(points) {
    if (!this.data.settings.points) this.data.settings.points = 0;
    this.data.settings.points += points;
    this.save();
    return this.data.settings.points;
  }

  calculateStreak() {
    const today = new Date();
    let streak = 0;
    let currentDate = new Date(today);
    
    // 今日から過去にさかのぼって連続日数を計算
    while (true) {
      const dateKey = this.getDateKey(currentDate);
      const record = this.data.records[dateKey];
      
      if (record && record.completed) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        // 今日の分が未完了の場合は昨日から開始
        if (dateKey === this.getDateKey(today)) {
          currentDate.setDate(currentDate.getDate() - 1);
          continue;
        }
        break;
      }
    }
    
    return streak;
  }
}

// メインアプリケーションコンポーネント
class App extends Component {
  constructor() {
    super();
    this.dataManager = new DataManager();
    this.state = {
      currentView: 'main', // main, calendar, settings
      currentDate: new Date(),
      todayRecord: this.dataManager.getTodayRecord(),
      selectedDate: null,
      showModal: false,
      theme: this.dataManager.data.settings.theme,
      points: this.dataManager.data.settings.points || 0,
      streak: this.dataManager.calculateStreak()
    };
  }

  componentDidMount() {
    // テーマを適用
    document.documentElement.setAttribute('data-theme', this.state.theme);
    
    // 30分チェックタイマーを開始
    this.lockResetTimer = setInterval(() => {
      this.checkLockReset();
    }, 60000); // 1分ごとにチェック
    
    // 初回チェック
    this.checkLockReset();
  }

  componentWillUnmount() {
    if (this.lockResetTimer) {
      clearInterval(this.lockResetTimer);
    }
  }

  checkLockReset = () => {
    const wasReset = this.dataManager.checkAndResetLocks();
    if (wasReset) {
      // リセットされた場合、状態を更新
      this.setState({ 
        todayRecord: this.dataManager.getTodayRecord(),
        streak: this.dataManager.calculateStreak()
      });
    }
  }

  formatDate(date) {
    const options = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      weekday: 'long' 
    };
    return date.toLocaleDateString('ja-JP', options);
  }

  toggleLock = (lockType) => {
    const currentState = this.state.todayRecord[lockType];
    const newRecord = this.dataManager.updateLockState(lockType, !currentState);
    
    // ボタン全体のアニメーション
    const buttonElement = document.querySelector(`.lock-button[data-lock="${lockType}"]`);
    const iconElement = document.querySelector(`.lock-button[data-lock="${lockType}"] .lock-icon`);
    
    if (buttonElement && iconElement) {
      // ロック時の特別なアニメーション
      if (!currentState) {
        buttonElement.classList.add('locking');
        iconElement.classList.add('switching');
        
        // 段階的なアニメーション
        setTimeout(() => {
          buttonElement.classList.remove('locking');
          iconElement.classList.remove('switching');
        }, 800);
        
        // 成功エフェクト
        this.createLockParticles(buttonElement);
      } else {
        iconElement.classList.add('switching');
        setTimeout(() => iconElement.classList.remove('switching'), 600);
      }
    }
    
    this.setState({ todayRecord: newRecord });
    
    // 楽しい振動フィードバック
    if ('vibrate' in navigator) {
      if (!currentState) {
        navigator.vibrate([150, 50, 150, 50, 200]); // ロック時：満足感のある振動
      } else {
        navigator.vibrate([100, 30, 100]); // アンロック時：軽い振動
      }
    }
    
    // サウンドエフェクト
    this.playLockSound(!currentState);
  }

  createLockParticles = (buttonElement) => {
    const rect = buttonElement.getBoundingClientRect();
    const particles = ['✨', '⭐', '💫', '🔒'];
    
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const particle = document.createElement('div');
        particle.textContent = particles[Math.floor(Math.random() * particles.length)];
        particle.style.cssText = `
          position: fixed;
          font-size: 20px;
          pointer-events: none;
          z-index: 1000;
          left: ${rect.left + Math.random() * rect.width}px;
          top: ${rect.top + Math.random() * rect.height}px;
          animation: particleFloat 2s ease-out forwards;
        `;
        
        document.body.appendChild(particle);
        
        setTimeout(() => {
          if (particle.parentNode) {
            particle.parentNode.removeChild(particle);
          }
        }, 2000);
      }, i * 100);
    }
  }

  playLockSound = (isLocking) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      if (isLocking) {
        // ロック音：上昇音
        oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.1);
      } else {
        // アンロック音：下降音
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.1);
      }
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
      // オーディオが利用できない場合は無視
    }
  }

  completeCheck = () => {
    if (this.state.todayRecord.completed) {
      // 完了処理とポイント付与チェック
      const result = this.dataManager.completeToday();
      
      if (!result) {
        return; // 完了条件を満たしていない
      }
      
      if (result.alreadyAwarded) {
        // 既にポイントが付与済みの場合、アニメーションのみ
        const button = document.querySelector('.complete-button');
        if (button) {
          button.classList.add('celebrating');
          setTimeout(() => button.classList.remove('celebrating'), 800);
        }
        
        if ('vibrate' in navigator) {
          navigator.vibrate([100, 50, 100]); // 短い振動
        }
        return;
      }
      
      // 初回完了の場合のみポイント付与
      const totalPoints = result.points;
      const newTotalPoints = this.dataManager.addPoints(totalPoints);
      const newStreak = this.dataManager.calculateStreak();
      
      // ポイントアニメーション
      this.showPointsAnimation(totalPoints);
      
      // 完了アニメーションを実行
      const button = document.querySelector('.complete-button');
      if (button) {
        button.classList.add('celebrating');
        setTimeout(() => button.classList.remove('celebrating'), 800);
      }
      
      // 状態更新
      this.setState({ 
        points: newTotalPoints,
        streak: newStreak,
        todayRecord: this.dataManager.getTodayRecord() // pointsAwarded状態も更新
      });
      
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 300]);
      }
      
      // 成功音
      this.playSuccessSound();
    }
  }

  showPointsAnimation = (points) => {
    const button = document.querySelector('.complete-button');
    if (button) {
      const rect = button.getBoundingClientRect();
      const animation = document.createElement('div');
      animation.className = 'points-animation';
      animation.textContent = `+${points}pt`;
      animation.style.left = `${rect.left + rect.width / 2}px`;
      animation.style.top = `${rect.top}px`;
      
      document.body.appendChild(animation);
      
      setTimeout(() => {
        document.body.removeChild(animation);
      }, 2000);
    }
  }

  playSuccessSound = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // 和音を作成
      const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
      const duration = 0.5;
      
      frequencies.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        
        oscillator.start(audioContext.currentTime + index * 0.1);
        oscillator.stop(audioContext.currentTime + duration + index * 0.1);
      });
    } catch (e) {
      // オーディオが利用できない場合は無視
    }
  }

  switchView = (view) => {
    // 現在のビューと同じ場合でもアニメーションを実行するため、
    // 一時的にcurrentViewをnullにしてからセットする
    this.setState({ currentView: null }, () => {
      // 次のフレームで新しいビューをセット
      requestAnimationFrame(() => {
        this.setState({ currentView: view });
      });
    });
  }

  showDateDetail = (dateKey) => {
    const record = this.dataManager.data.records[dateKey];
    this.setState({ 
      selectedDate: { key: dateKey, record },
      showModal: true 
    });
  }

  closeModal = () => {
    this.setState({ showModal: false, selectedDate: null });
  }

  toggleTheme = () => {
    const newTheme = this.state.theme === 'light' ? 'dark' : 'light';
    this.setState({ theme: newTheme });
    this.dataManager.updateSettings({ theme: newTheme });
    document.documentElement.setAttribute('data-theme', newTheme);
  }

  clearAllData = () => {
    if (confirm('すべてのデータを削除しますか？この操作は取り消せません。')) {
      this.dataManager.clearData();
      this.setState({ todayRecord: this.dataManager.getTodayRecord() });
    }
  }

  renderMainView() {
    const { todayRecord, points, streak } = this.state;
    
    return html`
      <div class=${`main-content ${this.state.currentView === 'main' ? 'active' : ''}`}>
        <div class="points-display">
          ⭐ ${points}pt
        </div>
        
        <div class="date-display">
          ${this.formatDate(this.state.currentDate)}
        </div>
        
        ${streak > 0 ? html`
          <div class="streak-display">
            <span class="streak-number">${streak}</span>
            <span class="streak-text">日連続達成 🔥</span>
          </div>
        ` : ''}
        
        <button 
          class=${`lock-button ${todayRecord.barLock ? 'locked' : 'unlocked'}`}
          data-lock="barLock"
          onClick=${() => this.toggleLock('barLock')}
        >
          <span class="lock-label">バー錠</span>
          <span class="lock-icon">
            ${todayRecord.barLock ? '🔒' : '🔓'}
          </span>
        </button>
        
        <button 
          class=${`lock-button ${todayRecord.mainLock ? 'locked' : 'unlocked'}`}
          data-lock="mainLock"
          onClick=${() => this.toggleLock('mainLock')}
        >
          <span class="lock-label">本錠</span>
          <span class="lock-icon">
            ${todayRecord.mainLock ? '🔒' : '🔓'}
          </span>
        </button>
        
        ${todayRecord.completed ? html`
          <button class="complete-button" onClick=${this.completeCheck}>
            ${todayRecord.pointsAwarded ? '✅ 完了済み' : `✅ 完了 ${streak > 0 ? `(+${10 + Math.min(streak * 2, 50)}pt)` : '(+10pt)'}`}
          </button>
        ` : ''}
      </div>
    `;
  }

  renderCalendarView() {
    const currentDate = this.state.currentDate;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const records = this.dataManager.getRecordsForMonth(year, month);
    
    // カレンダーグリッドを生成
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const days = [];
    const today = new Date();
    const todayKey = this.dataManager.getDateKey(today);
    
    // 曜日ヘッダー
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    weekdays.forEach(day => {
      days.push(html`<div class="calendar-cell header">${day}</div>`);
    });
    
    // 日付セルを生成
    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + i);
      const dateKey = this.dataManager.getDateKey(cellDate);
      const record = records[dateKey];
      const isCurrentMonth = cellDate.getMonth() === month;
      const isToday = dateKey === todayKey;
      
      let cellClass = 'calendar-cell';
      if (!isCurrentMonth) cellClass += ' other-month';
      if (isToday) cellClass += ' today';
      if (record?.completed) cellClass += ' completed';
      else if (record && (record.mainLock || record.barLock)) cellClass += ' incomplete';
      
      days.push(html`
        <div 
          class=${cellClass}
          onClick=${() => record ? this.showDateDetail(dateKey) : null}
        >
          ${cellDate.getDate()}
        </div>
      `);
    }
    
    return html`
      <div class="calendar-view active">
        <div class="calendar-header">
          <button class="month-nav" onClick=${() => this.navigateMonth(-1)}>‹</button>
          <div class="current-month">
            ${year}年${month + 1}月
          </div>
          <button class="month-nav" onClick=${() => this.navigateMonth(1)}>›</button>
        </div>
        <div class="calendar-grid">
          ${days}
        </div>
      </div>
    `;
  }

  navigateMonth = (direction) => {
    const newDate = new Date(this.state.currentDate);
    newDate.setMonth(newDate.getMonth() + direction);
    this.setState({ currentDate: newDate });
  }

  renderSettingsView() {
    return html`
      <div class="settings-view active">
        <div class="settings-section">
          <div class="settings-title">🎨 表示設定</div>
          <div class="setting-item">
            <span>テーマ</span>
            <div class="theme-switch">
              <button 
                class=${`theme-option ${this.state.theme === 'light' ? 'active' : ''}`}
                onClick=${() => this.state.theme !== 'light' && this.toggleTheme()}
              >
                ライト
              </button>
              <button 
                class=${`theme-option ${this.state.theme === 'dark' ? 'active' : ''}`}
                onClick=${() => this.state.theme !== 'dark' && this.toggleTheme()}
              >
                ダーク
              </button>
            </div>
          </div>
        </div>
        
        <div class="settings-section">
          <div class="settings-title">💾 データ管理</div>
          <div class="setting-item">
            <button 
              class="danger-button"
              onClick=${this.clearAllData}
            >
              データを初期化
            </button>
          </div>
        </div>
        
        <div class="settings-section">
          <div class="settings-title">ℹ️ アプリ情報</div>
          <div class="setting-item">
            <span>バージョン</span>
            <span>1.0.0</span>
          </div>
          <div class="setting-item">
            <span>作成日</span>
            <span>2024/6/23</span>
          </div>
        </div>
      </div>
    `;
  }

  renderModal() {
    if (!this.state.showModal || !this.state.selectedDate) return null;
    
    const { key, record } = this.state.selectedDate;
    const date = new Date(key);
    
    return html`
      <div class="modal-overlay active" onClick=${this.closeModal}>
        <div class="modal-content" onClick=${(e) => e.stopPropagation()}>
          <button class="modal-close" onClick=${this.closeModal}>×</button>
          <div class="modal-header">
            <div class="modal-title">
              📅 ${date.toLocaleDateString('ja-JP')}の記録
            </div>
          </div>
          
          <div class="setting-item">
            <span>状態</span>
            <span>${record?.completed ? '✅ 完了' : '⚠️ 未完了'}</span>
          </div>
          
          <div class="setting-item">
            <span>本錠</span>
            <span>${record?.mainLock ? '🔒 ロック済み' : '🔓 未ロック'}</span>
          </div>
          
          <div class="setting-item">
            <span>バー錠</span>
            <span>${record?.barLock ? '🔒 ロック済み' : '🔓 未ロック'}</span>
          </div>
          
          ${record?.timestamp ? html`
            <div class="setting-item">
              <span>記録時刻</span>
              <span>${new Date(record.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ` : ''}
          
          <button 
            class="complete-button" 
            style="margin-top: 24px;"
            onClick=${this.closeModal}
          >
            閉じる
          </button>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="main-container">
        <div class="content-area">
          ${this.state.currentView === 'main' ? this.renderMainView() : ''}
          ${this.state.currentView === 'calendar' ? this.renderCalendarView() : ''}
          ${this.state.currentView === 'settings' ? this.renderSettingsView() : ''}
        </div>
        
        ${this.renderModal()}
      </div>
      
      <nav class="bottom-nav">
        <div class="nav-container">
          <div class=${`nav-indicator ${this.state.currentView}`}></div>
          <button 
            class=${`nav-button ${this.state.currentView === 'calendar' ? 'active' : ''}`}
            onClick=${() => this.switchView('calendar')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span class="nav-label">履歴</span>
          </button>
          <button 
            class=${`nav-button ${this.state.currentView === 'main' ? 'active' : ''}`}
            onClick=${() => this.switchView('main')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9,22 9,12 15,12 15,22"></polyline>
            </svg>
            <span class="nav-label">ホーム</span>
          </button>
          <button 
            class=${`nav-button ${this.state.currentView === 'settings' ? 'active' : ''}`}
            onClick=${() => this.switchView('settings')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="m12 1 1.68 2.07a4 4 0 0 0 1.75.93l2.67.5a4 4 0 0 1 2.12 2.12l.5 2.67a4 4 0 0 0 .93 1.75L23 12l-1.68 2.07a4 4 0 0 0-.93 1.75l-.5 2.67a4 4 0 0 1-2.12 2.12l-2.67.5a4 4 0 0 0-1.75.93L12 23l-2.07-1.68a4 4 0 0 0-1.75-.93l-2.67-.5a4 4 0 0 1-2.12-2.12l-.5-2.67a4 4 0 0 0-.93-1.75L1 12l1.68-2.07a4 4 0 0 0 .93-1.75l.5-2.67a4 4 0 0 1 2.12-2.12l2.67-.5a4 4 0 0 0 1.75-.93L12 1Z"></path>
            </svg>
            <span class="nav-label">設定</span>
          </button>
        </div>
      </nav>
    `;
  }
}

// アプリケーション起動
render(html`<${App} />`, document.getElementById('app'));