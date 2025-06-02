import Phaser from 'phaser';
import type { Chart, Note } from '../types/chart';

const JUDGE = { perfect: 0.10, good: 0.15, miss: 0.20};

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
  private resultContainer?: Phaser.GameObjects.Container;

  private debugMode = false;
  private debugText!: Phaser.GameObjects.Text;

  /* 랜 색상 설정 (lanes grouping) */
  private laneColors!: Record<number, number>;

  constructor() { super({ key: 'GameScene' }); }

  init(data: { songId: string; keyMode: 4 | 5 | 6; volume: number }) {
    this.songId = data.songId;
    this.keyMode = data.keyMode;
    this.initialVolume = data.volume;

    const blue = 0x4f86f7, red = 0xf76e6e;
    this.laneColors = {};
    if (this.keyMode === 4) {
      [1, 4].forEach(l => this.laneColors[l] = blue);
      [2, 3].forEach(l => this.laneColors[l] = red);
    } else {
      for (let l = 1; l <= this.keyMode; l++) {
        this.laneColors[l] = (l % 2 === 1 ? blue : red);
      }
    }
  }

  preload() {
    this.load.json(this.songId, `/api/chart/${this.songId}`);
    // this.load.image('particle', 'assets/img/particle.png');
  }

  create() {
    // make simple circle particle texture
    const gfx = this.add.graphics();
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(5, 5, 5);
    gfx.generateTexture('particle', 10, 10);
    gfx.destroy();

    this.chart = this.cache.json.get(this.songId) as Chart;
    const list = this.chart[`${this.keyMode}key` as '4key'|'5key'|'6key'];
    this.totalNotes = list.chaebo.length;
    this.audio = new Audio(`/api/audio/${this.songId}`);
    this.audio.volume = this.initialVolume;
    this.audio.preload = 'auto';
    this.audio.load();

    this.buildHUD();
    this.drawColumns();
    this.spawnNotes(list.chaebo);
    this.setupInput();

    // 외부에서 Scene.pause() 호출 시 처리
    this.events.on('pause', () => {
      this.paused = true;
      this.audio.pause();
    });
    // 외부에서 Scene.resume() 호출 시 처리
    this.events.on('resume', () => {
      this.paused = false;
      if (this.songStarted) this.audio.play();
    });

    window.addEventListener('rg-set-volume', (e: any) => {
      this.audio.volume = e.detail as number;
    });
    this.events.on('shutdown', () => this.audio.pause());

    this.startCountdown();
  }

  setupInput() {
    this.laneKeys = this.keyMap[this.keyMode].map(code =>
      this.input.keyboard.addKey(code)
    );
  
    this.input.keyboard.on('keydown-U', () => this.toggleDebug());
    this.input.keyboard.on('keydown-ONE', () => this.speed = Math.max(0.5, this.speed - 0.5));
    this.input.keyboard.on('keydown-TWO', () => this.speed += 0.5);
    this.input.keyboard.on('keydown-ESC', () => {
      this.audio.pause();
      this.scene.stop();
      window.dispatchEvent(new CustomEvent('rg-exit'));
    });
  }

  startCountdown() {
    const txt = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      '3', { font: 'bold 64px Arial', color: '#ffffff' }
    ).setOrigin(0.5).setDepth(40);

    let count = 3;
    this.time.addEvent({ delay: 1000, repeat: 2, callback: () => {
      txt.setText(String(--count));
    }});

    this.time.delayedCall(3000, () => {
      txt.destroy();
      this.virtualTime = -this.approachSec;
      this.audio.play();
      this.songStarted = true;
    });
  }

  update(_time: number, delta: number) {
    if (this.paused || this.resultContainer) return; // 결과창 보이는 동안 업데이트 중지

    // 동시 입력 처리
    this.laneKeys.forEach((key, idx) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.onLaneDown(idx);
      if (Phaser.Input.Keyboard.JustUp(key)) this.onLaneUp(idx);
    });

    // 가상 시간 진행
    this.virtualTime += delta / 1000;
    if (this.songStarted) {
      const drift = this.audio.currentTime - this.virtualTime;
      if (Math.abs(drift) > this.SYNC_THRESHOLD) this.virtualTime += drift;
    }

    // 노트 위치 업데이트
    for (const an of this.notes) {
      const dy = an.note.time - this.virtualTime;
      const y  = this.judgeY - dy * this.pps;
      an.head.y = y;
      an.head.setVisible(y >= -70 && y <= this.scale.height + 70);
      if (an.body) an.body.y = y + (noteLengthInPixels
        = (an.note.end! - an.note.time) * this.pps) / 2;

      // 디버그 라벨
      if (this.debugMode) {
        if (!an.label) {
          an.label = this.add.text(
            an.head.x + 18, y - 6,
            an.note.time.toFixed(2) + 's',
            { fontSize: '10px', color: '#00e5ff' }
          ).setDepth(50);
        } else an.label.setPosition(an.head.x + 18, y - 6);
      }
    }
  for (const an of this.notes) {
    if (
      an.note.type === 'short' &&
      !an.judged &&
      this.virtualTime > an.note.time + JUDGE.miss
    ) {
      // laneIdx를 넘기지 않으면 빨간 플래시 없이 Miss 텍스트만 뜹니다
      this.judge(
        an,
        'Miss',
        0,
        this.laneColors[an.note.position]
      );
    }
  }

    // 디버그 텍스트
    if (this.debugMode) {
      this.debugText.setText(
        `audio  : ${this.audio.currentTime.toFixed(3)} s\n` +
        `virtual: ${this.virtualTime.toFixed(3)} s`
      );
    }

    // 판정 완료 노트 제거
    this.notes = this.notes.filter(n => !n.judged && !n.cancelled);

    // 종료 검사
    if (this.judgedCnt === this.totalNotes) this.showResults();
  }

/** 1) 키 눌렀을 때 */
private onLaneDown(idx: number) {
  if (this.virtualTime < -0.05) return;
  const now   = this.audio.currentTime;
  const blue  = 0x4f86f7;
  const red   = 0xf76e6e;

  // 언제나 파란 플래시
  this.flashColumn(idx, blue);

  // 가장 가까운 미판정 노트
  const candidate = this.notes
    .filter(n => !n.judged && n.note.position === idx+1)
    .sort((a, b) => Math.abs(a.note.time - now) - Math.abs(b.note.time - now))[0];
  if (!candidate) return;

  const diff = Math.abs(candidate.note.time - now);

  // 판정 범위 밖: 아무 처리 없이 리턴
  if (diff > JUDGE.miss) {
    return;
  }

  // Miss
  if (diff > JUDGE.good) {
    this.flashColumn(idx, red);
    this.judge(candidate, 'Miss', 0, red, idx);
    return;
  }

  // Good
  if (diff > JUDGE.perfect) {
    this.judge(candidate, 'Good', 50, this.laneColors[candidate.note.position], idx);
    return;
  }

  // Perfect
  this.judge(candidate, 'Perfect', 100, this.laneColors[candidate.note.position], idx);
}


/** 2) 롱노트 해제 시 */
private onLaneUp(idx: number) {
  const now = this.audio.currentTime;
  const red = 0xf76e6e;

  this.notes
    .filter(n => n.note.type === 'long' && n.started && !n.judged && n.note.position === idx + 1)
    .sort((a, b) => Math.abs(a.note.end! - now) - Math.abs(b.note.end! - now))
    .forEach(n => {
      const diff = Math.abs(n.note.end! - now);

      // Miss
      if (diff > JUDGE.miss) {
        this.flashColumn(idx, red);
        this.judge(n, 'Miss', 0, red, idx);
        return;
      }

      // Perfect / Good / Bad
      let msg: 'Perfect'|'Good'|'Bad';
      let score: number;
      if (diff <= JUDGE.perfect) {
        msg = 'Perfect'; score = 100;
      } else if (diff <= JUDGE.good) {
        msg = 'Good'; score = 50;
      } else {
        msg = 'Bad'; score = 0;
      }
      this.judge(n, msg, score, this.laneColors[n.note.position], idx);
    });
}
/** 3) 지정 색으로 반짝임 */
private flashColumn(idx: number, color: number) {
  const w = this.scale.width / this.keyMode;
  const x = w * idx + w / 2;
  const rect = this.add
    .rectangle(x, this.judgeY / 2, w, this.judgeY, color, 0.5)
    .setOrigin(0.5);
  this.tweens.add({
    targets: rect,
    alpha: 0,
    duration: 200,
    onComplete: () => rect.destroy()
  });
}

    judge(n: ActiveNote, msg: string, score: number, color: number, laneIdx?: number) {
    n.judged=true;
    n.head.destroy(); n.body?.destroy(); n.label?.destroy();
    this.showFeedback(msg);
    if(score===0&&laneIdx!==undefined) this.flashColumn(laneIdx,0xf76e6e);
    if(score>0&&laneIdx!==undefined) this.sparkEffect(laneIdx,color);

    this.totalScore+=score;
    this.judgedCnt++;
    const pct = Math.round(this.totalScore/(this.totalNotes*100)*100);
    this.scoreText.setText(`${pct}%`);

    this.combo = score>0?this.combo+1:0;
    if(this.combo>1){
      this.comboTitle.setText('Combo!')
        .setFont('bold 40px Arial Black').setAlpha(1).setScale(1.5);
      this.comboCount.setText(`${this.combo}`)
        .setFont('bold 32px Arial Black').setAlpha(1).setScale(1.5);
      this.tweens.add({targets:[this.comboTitle,this.comboCount], scale:1, duration:100});
    } else {
      this.comboTitle.setAlpha(0);
      this.comboCount.setAlpha(0);
    }
  }

  // 스파크 효과 생성
private sparkEffect(idx: number, color: number) {
  const w = this.scale.width / this.keyMode;
  const x = w * idx + w / 2;
  const y = this.judgeY;

  // Phaser 3.60+ 에서는 add.particles(x, y, key, config)로 ParticleEmitter 생성
  const emitter = this.add.particles(x, y, 'particle', {
    speed: { min: 150, max: 300 },
    scale: { start: 1, end: 0 },
    alpha: { start: 1, end: 0 },
    tint: color,
    lifespan: 400,
    blendMode: 'ADD'
  });

  // explode 메서드로 즉시 20개 파티클 폭발 생성
  emitter.explode(20); // explode 메서드 호출 :contentReference[oaicite:1]{index=1}

  // 메모리 누수 방지를 위해 잠시 후 파괴
  this.time.delayedCall(500, () => emitter.destroy());
}


  buildHUD() {
    this.scoreText=this.add.text(10,10,'0%',{font:'16px Arial',color:'#ffffff'});
    const cx=this.cameras.main.centerX, cy=this.cameras.main.centerY;
    this.comboTitle=this.add.text(cx,cy-40,'Combo!',{font:'bold 40px Arial Black',color:'#ffff00'})
      .setOrigin(0.5).setAlpha(0);
    this.comboCount=this.add.text(cx,cy+5,'',{font:'bold 32px Arial Black',color:'#ffcc00'})
      .setOrigin(0.5).setAlpha(0);
    this.feedbackText=this.add.text(cx,this.judgeY-50,'',{font:'bold 32px Arial Black',color:'#00ffff'})
      .setOrigin(0.5).setAlpha(0);
    this.debugText=this.add.text(2,2,'',{font:'14px Courier',color:'#00ff00'})
      .setScrollFactor(0).setVisible(false);
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
    g.lineTo(w, this.judgeY); g.strokePath();
  }

/** 4) 판정 메시지: 크기·색상 분기 */
private showFeedback(msg: string) {
  this.tweens.killTweensOf(this.feedbackText);

  let colorHex: number;
  let fontSpec: string;
  switch (msg) {
    case 'Perfect':
      colorHex = 0x00ffff; // sky blue
      fontSpec = 'bold 48px Arial Black';
      break;
    case 'Good':
      colorHex = 0xb2ff59; // light green
      fontSpec = 'bold 40px Arial Black';
      break;
    case 'Bad':
      colorHex = 0xff6b6b; // red
      fontSpec = 'bold 32px Arial Black';
      break;
    default: // Miss
      colorHex = 0xaaaaaa; // light gray
      fontSpec = 'bold 32px Arial Black';
      msg = 'Miss';
      break;
  }

  this.feedbackText
    .setText(msg)
    .setFont(fontSpec)
    .setColor(`#${colorHex.toString(16).padStart(6, '0')}`)
    .setAlpha(1);

  this.tweens.add({
    targets: this.feedbackText,
    alpha: 0,
    duration: 500
  });
}

  // 게임 종료 결과 표시
private showResults() {
  const cx = this.cameras.main.centerX;
  const cy = this.cameras.main.centerY;
  const pct = Math.round((this.totalScore / (this.totalNotes * 100)) * 100);
  const highKey = `${this.songId}_${this.keyMode}`;
  const prevHigh = Number(localStorage.getItem(highKey) || '0');
  if (pct > prevHigh) localStorage.setItem(highKey, String(pct));

  const overlay = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.7).setOrigin(0);
  const title = this.add
    .text(cx, cy - 60, pct >= 70 ? 'Clear!' : 'Fail...', { font: 'bold 48px Arial', color: '#ffffff' })
    .setOrigin(0.5);
  const detail = this.add
    .text(cx, cy, `${pct}%`, { font: '64px Arial', color: '#ffffff' })
    .setOrigin(0.5);
  const scoreText = this.add
    .text(cx, cy + 50, `${this.totalScore}/${this.totalNotes * 100}`, { font: '16px Arial', color: '#dddddd' })
    .setOrigin(0.5);

  const children: Phaser.GameObjects.GameObject[] = [overlay, title, detail, scoreText];
  if (prevHigh > 0) {
    const highText = this.add
      .text(cx, cy + 80, `Previous High: ${prevHigh}%`, { font: '16px Arial', color: '#dddddd' })
      .setOrigin(0.5);
    children.push(highText);
  }

  const btn = this.add
    .text(cx, cy + 120, 'Return to Menu', { font: '20px Arial', color: '#00aaff' })
    .setOrigin(0.5)
    .setInteractive();
  btn.on('pointerup', () =>{ 
    this.audio.pause();
    this.scene.stop();
    window.dispatchEvent(new CustomEvent('rg-exit'));
  });
  children.push(btn);

  this.resultContainer = this.add.container(0, 0, children);
}

  // private togglePause() {
  //   this.paused = !this.paused;
  //   if (this.paused) { this.scene.pause(); this.audio.pause(); }
  //   else         { this.scene.resume(); this.audio.play();  }
  // }

  private toggleDebug() {
    this.debugMode = !this.debugMode;
    this.debugText.setVisible(this.debugMode);
    if (!this.debugMode) this.notes.forEach(n => n.label?.setVisible(false));
  }

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

  private spawnNotes(list: Note[]) {
    const colW = this.scale.width / this.keyMode;
    list.forEach(note => {
      const x = colW * (note.position - 0.5);
      // 헤드 색상 지정
      const color = this.laneColors[note.position];
      const head = this.add.rectangle(x, -40, colW * 0.8, 20, color).setOrigin(0.5);
      let body: Phaser.GameObjects.Rectangle | undefined;
      if (note.type === 'long') {
        body = this.add.rectangle(
          x, this.judgeY,
          colW * 0.4,
          (note.end! - note.time) * this.pps,
          color
        ).setOrigin(0.5, 1);
      }
      this.notes.push({ note, head, body, started: false, judged: false, cancelled: false });
    });
  }
}
