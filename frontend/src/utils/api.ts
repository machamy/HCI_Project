// src/utils/api.ts

import type { SongData } from '../types/song';
import type { Chart } from '../types/chart';

/**
 * 서버에 저장된 곡 목록을 가져옵니다.
 * @returns SongData 배열
 */
export async function fetchSongList(): Promise<SongData[]> {
  const res = await fetch('/api/songs');
  const data = await res.json();
  return data.songs as SongData[];
}

/**
 * 음악 파일과 (선택)곡 이름을 업로드하고 차트를 생성합니다.
 * @param file - 업로드할 File 객체
 * @param name - 곡 이름 (optional)
 * @param extraPrompt - LLM에 보낼 추가 프롬프트 (optional)
 * @param slowRate - slow_rate 값 (0.25~1.00)
 * @returns 생성된 song_id
 */
export async function uploadMusic(
  file: File,
  name?: string,
  extraPrompt: string = "",
  slowRate: number = 1.0
): Promise<{ song_id: string }> {
  const form = new FormData();
  form.append('file', file);
  if (name) form.append('name', name);
  form.append('use_llm', 'true');
  form.append('extra_prompt', extraPrompt);
  form.append('slow_rate', slowRate.toString());

  const res = await fetch('/api/upload/', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error('Failed to upload and generate chart');
  return res.json();
}


/**
 * 특정 song_id에 대응하는 차트 JSON을 가져옵니다.
 * @param songId - 조회할 곡의 UUID
 * @returns Chart 객체
 */
export async function fetchChart(songId: string): Promise<Chart> {
  const res = await fetch(`/api/chart/${songId}`);
  return res.json();
}


/**
 * 특정 곡의 차트를 재생성합니다.
 * @param songId - 재생성할 곡의 UUID
 * @param extraPrompt - LLM에 보낼 추가 프롬프트 (optional)
 * @param keyMode - 키 모드 (4, 5, 6 중 하나)
 * @param slowRate - slow_rate 값 (0.25~1.00)
 * @returns 생성된 차트 JSON
 */
export async function regenerateChart(
  songId: string,
  extraPrompt: string,
  keyMode: 4 | 5 | 6,
  slowRate: number
): Promise<any> {
  const formData = new FormData();
  formData.append('use_llm', 'true');
  formData.append('extra_prompt', extraPrompt);
  formData.append('key', keyMode.toString());
  formData.append('slow_rate', slowRate.toString());  // 👈 추가

  const res = await fetch(`/api/regenerate/${songId}`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Failed to regenerate chart for ${keyMode}-key`);
  }

  return res.json();
}
/**
 * 특정 song_id 의 곡을 삭제합니다.
 * @param songId - 삭제할 곡의 UUID
 */
export async function deleteSong(songId: string): Promise<void> {
  const res = await fetch(`/api/song/${songId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Failed to delete song ${songId}`);
  }
}