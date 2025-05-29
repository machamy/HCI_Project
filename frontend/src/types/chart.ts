export interface Note {
  time: number;
  type: 'short' | 'long' | 'change_beat';
  position: number;
  end?: number;
  beat?: number;
}

// 키별 차트 하나에 대한 타입
export interface KeyChart {
  maxscore: { score: number; player: string };
  chaebo: Note[];
}

// 전체 차트 타입: 4key,5key,6key 프로퍼티
export interface Chart {
  '4key': KeyChart;
  '5key': KeyChart;
  '6key': KeyChart;
}
