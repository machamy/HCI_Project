// src/components/DebugPrompt.tsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const DebugPrompt: React.FC = () => {
  const { prompt_id } = useParams(); // URL에서 prompt_id를 가져옴
  const [prompt, setPrompt] = useState<string | null>(null); // API에서 받은 프롬프트 상태
  const [error, setError] = useState<string | null>(null); // 에러 상태

  useEffect(() => {
    // API 호출
    const fetchPrompt = async () => {
      try {
        const response = await fetch(`/debug/prompt/${prompt_id}`);
        const data = await response.json();

        if (data.prompt) {
          setPrompt(data.prompt); // 프롬프트 데이터가 있으면 상태에 저장
        } else {
          setError(data.error || 'Unknown error'); // 에러가 있으면 상태에 저장
        }
      } catch (e) {
        setError('Failed to fetch prompt data'); // API 호출 실패 시 에러 처리
      }
    };

    fetchPrompt();
  }, [prompt_id]); // prompt_id가 변경될 때마다 호출

  if (error) {
    return <div>Error: {error}</div>; // 에러가 있으면 표시
  }

  return (
    <div>
      <h1>Debug Prompt {prompt_id}</h1>
      {prompt ? (
        <pre>{prompt}</pre> // 프롬프트가 있으면 표시
      ) : (
        <p>Loading...</p> // 로딩 중에는 "Loading..." 표시
      )}
    </div>
  );
};

export default DebugPrompt;
