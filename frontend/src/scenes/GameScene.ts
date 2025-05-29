import Phaser from 'phaser';
import type { Chart, Note } from '../types/chart';

const JUDGE = { perfect: 0.10, good: 0.15, miss: 0.25 };

interface ActiveNote {
  note: Note;
  head: Phaser.GameObjects.Rectangle;
  body?: Phaser.GameObjects.Rectangle;
  label?: Phaser.GameObjects.Text;  // 디버그용
  started: boolean;
  judged: boolean;
  cancelled: boolean;
}

export class GameScene extends Phaser.Scene {
  /* 전달 데이터 */
  private songId!: string;
  private keyMode!: 4 | 5 | 6;
  private initialVolume = 1;

  /* 오디오 */
  private audio!: HTMLAudioElement;
  private songStarted = false;

  /* 시간 */
  private approachSec = 2;
  private virtualTime = -this.approachSec - 3;
  private readonly SYNC_THRESHOLD = 0.02;

  /* 차트 & 노트 */
  private chart!: Chart;
  private notes: ActiveNote[] = [];

  /* 판정 파라미터 */
  private judgeY = 500;
  private speed  = 1;
  private get pps() { return (this.judgeY / this.approachSec) * this.speed; }

  private paused = false;

  /* HUD & 그래픽 */
  private totalScore = 0;
  private totalNotes = 0;
  private judgedCnt  = 0;
  private combo      = 0;

  private scoreText!:      Phaser.GameObjects.Text;
  private comboTitle!:     Phaser.GameObjects.Text;
  private comboCount!:     Phaser.GameObjects.Text;
  private feedbackText!:   Phaser.GameObjects.Text;
  private glow!:           Phaser.GameObjects.Graphics;

  private debugMode = false;
  private debugText!: Phaser.GameObjects.Text;

  private laneKeys: Phaser.Input.Keyboard.Key[] = [];
  private keyMap: Record<4|5|6, number[]> = {
    4: [Phaser.Input.Keyboard.KeyCodes.S, Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.L, Phaser.Input.Keyboard.KeyCodes.SEMICOLON],
    5: [Phaser.Input.Keyboard.KeyCodes.S, Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.L, Phaser.Input.Keyboard.KeyCodes.SEMICOLON],
    6: [Phaser.Input.Keyboard.KeyCodes.A, Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.L, Phaser.Input.Keyboard.KeyCodes.SEMICOLON,
        Phaser.Input.Keyboard.KeyCodes.QUOTES],
  };

  constructor() { super({ key: 'GameScene' }); }

  init(data:{ songId:string; keyMode:4|5|6; volume:number }) {
    this.songId = data.songId;
    this.keyMode = data.keyMode;
    this.initialVolume = data.volume;
  }

  preload() {
    this.load.json(this.songId, `/api/chart/${this.songId}`);
  }

  create() {
    // 1) 차트 로드
    this.chart = this.cache.json.get(this.songId) as Chart;
    const list = this.chart[`${this.keyMode}key` as '4key'|'5key'|'6key'];
    this.totalNotes = list.chaebo.length;

    // 2) 오디오 설정
    this.audio = new Audio(`/api/audio/${this.songId}`);
    this.audio.volume  = this.initialVolume;
    this.audio.preload = 'auto';
    this.audio.load();

    // 3) HUD & 판정선
    this.buildHUD();
    this.glow = this.add.graphics();
    this.drawColumns();

    // 4) 노트 생성
    this.spawnNotes(list.chaebo);

    // 5) 입력 설정
    this.setupInput();

    // 볼륨 변경 이벤트
    window.addEventListener('rg-set-volume', (e:any) => {
      this.audio.volume = e.detail as number;
    });

    // 6) 카운트다운 후 재생
    this.startCountdown();
  }

  private setupInput() {
    // 각 키를 Key 객체로 생성
    this.laneKeys = this.keyMap[this.keyMode].map(code =>
      this.input.keyboard.addKey(code)
    );
    // P, U, 속도 조절 키
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    this.input.keyboard.on('keydown-U', () => this.toggleDebug());
    this.input.keyboard.on('keydown-ONE', () => this.speed = Math.max(0.5, this.speed - 0.5));
    this.input.keyboard.on('keydown-TWO', () => this.speed += 0.5);
  }

  private startCountdown() {
    const txt = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      '3', { fontSize:'64px', color:'#fff' }
    ).setOrigin(0.5).setDepth(40);

    let count = 3;
    this.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        count--;
        txt.setText(String(count));
      }
    });

    this.time.delayedCall(3000, () => {
      txt.destroy();
      this.virtualTime = -this.approachSec;
      this.audio.play();
      this.songStarted = true;
    });
  }

  update(_time: number, delta: number) {
    if (this.paused) return;

    // 동시 입력 처리
    this.laneKeys.forEach((key, idx) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.onLaneDown(idx);
      if (Phaser.Input.Keyboard.JustUp(key)) this.onLaneUp(idx);
    });

    // 가상 시간 진행
    this.virtualTime += delta / 1000;
    if (this.songStarted) {
      const drift = this.audio.currentTime - this.virtualTime;
      if (Math.abs(drift) > this.SYNC_THRESHOLD) {
        this.virtualTime += drift;
      }
    }

    // 노트 위치 업데이트
    for (const an of this.notes) {
      const dy = an.note.time - this.virtualTime;
      const y  = this.judgeY - dy * this.pps;
      an.head.y = y;
      an.head.setVisible(y >= -70 && y <= this.scale.height + 70);

      // 디버그 라벨
      if (this.debugMode) {
        if (!an.label) {
          an.label = this.add.text(
            an.head.x + 18, y - 6,
            an.note.time.toFixed(2) + 's',
            { fontSize: '10px', color: '#00e5ff' }
          ).setDepth(50);
        } else {
          an.label.setPosition(an.head.x + 18, y - 6);
        }
      }
    }

    // 디버그 텍스트
    if (this.debugMode) {
      this.debugText.setText(
        `audio  : ${this.audio.currentTime.toFixed(3)} s\n` +
        `virtual: ${this.virtualTime.toFixed(3)} s`
      );
    }

    // 배열 정리
    this.notes = this.notes.filter(n => !n.judged && !n.cancelled);
  }

  private onLaneDown(idx: number) {
    if (this.virtualTime < -0.05) return;
    this.flashColumn(idx);
    const now = this.audio.currentTime;
    this.notes
      .filter(n => !n.judged && n.note.position === idx + 1)
      .sort((a, b) => Math.abs(a.note.time - now) - Math.abs(b.note.time - now))
      .forEach(n => {
        const diff = Math.abs(n.note.time - now);
        if (diff > JUDGE.miss) return;
        const { perfect, good } = JUDGE;
        let score = 0;
        let msg = 'Miss';
        let col = 0xFF6B6B;
        if (diff <= perfect)      { score = 100; msg = 'Perfect!'; col = 0xA8E6CF; }
        else if (diff <= good)    { score =  50; msg = 'Fast';     col = 0xA8E6CF; }
        this.judge(n, msg, score, col);
      });
  }

  private onLaneUp(idx: number) {
    const now = this.audio.currentTime;
    this.notes
      .filter(n => n.note.type === 'long' && n.started && !n.judged && n.note.position === idx + 1)
      .sort((a, b) => Math.abs(a.note.end! - now) - Math.abs(b.note.end! - now))
      .forEach(n => {
        const diff = Math.abs(n.note.end! - now);
        if (diff > JUDGE.miss) {
          this.judge(n, 'Miss', 0, 0xFF6B6B);
        } else {
          const perf = diff <= JUDGE.perfect;
          const score = perf
            ? 100
            : Math.round(Phaser.Math.Linear(99, 50, (diff - JUDGE.perfect) / (JUDGE.good - JUDGE.perfect)));
          this.judge(n, perf ? 'Perfect!' : 'Slow', score, 0xA8E6CF);
        }
      });
  }

  private flashColumn(idx: number) {
    const colW = this.scale.width / this.keyMode;
    const x = colW * idx + colW / 2;
    const rect = this.add.rectangle(
      x, this.judgeY / 2,
      colW, this.judgeY,
      0x8ecae6, 0.5
    ).setOrigin(0.5);
    this.tweens.add({
      targets: rect,
      alpha: 0,
      duration: 200,
      onComplete: () => rect.destroy()
    });
  }
  private judge(n: ActiveNote, msg: string, score: number, color: number) {
    n.judged = true;
    n.head.destroy();
    n.body?.destroy();
    n.label?.destroy();
    this.showFeedback(msg, color);
    this.totalScore += score;
    this.judgedCnt++;
    const pct = Math.round((this.totalScore / Math.max(1, this.judgedCnt * 100)) * 100);
    this.scoreText.setText(`${pct}%`);
    this.combo = score > 0 ? this.combo + 1 : 0;
    if (this.combo > 1) {
      this.comboTitle
        .setAlpha(1)
        .setFontSize(48)
        .setStroke('#FFD700', 4)
        .setShadow(2, 2, '#000', 2);
      this.comboCount
        .setText(String(this.combo))
        .setAlpha(1)
        .setFontSize(36)
        .setStroke('#FFA500', 4)
        .setShadow(2, 2, '#000', 2);
    } else {
      this.comboTitle.setAlpha(0);
      this.comboCount.setAlpha(0);
    }
  }


  private buildHUD() {
    this.scoreText = this.add.text(10, 10, '0%', { fontSize: '16px', color: '#B2EBF2' });
    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;
    this.comboTitle = this.add.text(cx, cy - 40, 'Combo!', { fontSize: '32px', color: '#FFE4E1' })
      .setOrigin(0.5).setAlpha(0);
    this.comboCount = this.add.text(cx, cy + 5, '', { fontSize: '24px', color: '#FFE4E1' })
      .setOrigin(0.5).setStroke('#FFC0CB', 3).setAlpha(0);
    this.feedbackText = this.add.text(cx, this.judgeY - 50, '', { fontSize: '32px', color: '#E0FFFF' })
      .setOrigin(0.5).setAlpha(0);
    this.debugText = this.add.text(2, 2, '', { fontSize: '14px', color: '#00e5ff' })
      .setDepth(60).setScrollFactor(0).setVisible(false);
  }

  private drawColumns() {
    const g = this.add.graphics();
    const w = this.scale.width;
    const h = this.scale.height;
    const colW = w / this.keyMode;
    g.lineStyle(1, 0xcccccc, 0.3);
    for (let i = 1; i < this.keyMode; i++) {
      const x = colW * i;
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    g.lineStyle(4, 0xffffff);
    g.moveTo(0, this.judgeY);
    g.lineTo(w, this.judgeY);
    g.strokePath();
  }

  private togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      this.scene.pause();
      this.audio.pause();
    } else {
      this.scene.resume();
      this.audio.play();
    }
  }

  private toggleDebug() {
    this.debugMode = !this.debugMode;
    this.debugText.setVisible(this.debugMode);
    if (!this.debugMode) this.notes.forEach(n => n.label?.setVisible(false));
  }

    /* spawnNotes: 차트에서 받은 chaebo 데이터를 기반으로 노트 객체 생성 */
  private spawnNotes(list: Note[]) {
    const colW = this.scale.width / this.keyMode;
    list.forEach(note => {
      const x = colW * (note.position - 0.5);
      const head = this.add.rectangle(x, -40, colW * 0.8, 20, 0xffffff).setOrigin(0.5);
      let body: Phaser.GameObjects.Rectangle | undefined;
      if (note.type === 'long') {
        body = this.add.rectangle(x, this.judgeY, colW * 0.4, (note.end! - note.time) * this.pps, 0xffffff)
                       .setOrigin(0.5, 1);
      }
      this.notes.push({ note, head, body, started: false, judged: false, cancelled: false });
    });
  }

  private showFeedback(msg: string, color: number) {
    this.feedbackText
      .setText(msg)
      .setColor(`#${color.toString(16).padStart(6, '0')}`)
      .setAlpha(1)
      .setFontSize(40)
      .setStroke('#00FFFF', 4)
      .setShadow(2, 2, '#000', 2);
    this.tweens.add({
      targets: this.feedbackText,
      alpha: 0,
      delay: 0,
      duration: 500
    });
  }

}
