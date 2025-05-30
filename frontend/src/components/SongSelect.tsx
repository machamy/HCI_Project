import React, { useEffect, useState } from 'react';
import { fetchSongList, uploadMusic, regenerateChart, deleteSong } from '../utils/api';
import type { SongData } from '../types/song';
import { useNavigate } from 'react-router-dom';

const SongSelect: React.FC = () => {
  const [songs, setSongs] = useState<SongData[]>([]);
  const [uploading, setUploading] = useState(false);
  const [keyMode, setKeyMode] = useState<4|5|6>(4);
  const [uploadName, setUploadName] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [targetSong, setTargetSong] = useState<SongData | null>(null);
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenKey, setRegenKey] = useState<4|5|6>(4);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenSlowRate, setRegenSlowRate] = useState<number>(1.0);
  const [genModalVisible, setGenModalVisible]   = useState(false);
  const [genPrompt,        setGenPrompt]        = useState('');
  const [genSlowRate,      setGenSlowRate]      = useState<number>(1.0);
  const [selectedFile,     setSelectedFile]     = useState<File | null>(null);

  const navigate = useNavigate();

  const loadSongs = async () => {
    const data = await fetchSongList();
    setSongs(data);
  };

  useEffect(() => {
    loadSongs();
  }, []);

  const filtered = songs.filter(s => {
    if (keyMode === 4) return s.has4;
    if (keyMode === 5) return s.has5;
    return s.has6;
  });

  const handlePlay = (song: SongData) => {
    navigate('/play', { state: { songId: song.song_id, keyMode } });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setGenPrompt('');
    setGenSlowRate(1.0);
    setGenModalVisible(true);
    e.target.value = '';
  };

  // 모달에서 “Generate” 클릭
  const handleGenerate = async () => {
    if (!selectedFile) return;
    setUploading(true);
    const defaultName = selectedFile.name.replace(/\.[^/.]+$/, '');
    const nameToUse = uploadName.trim() || defaultName;
    await uploadMusic(
      selectedFile,
      nameToUse,
      genPrompt,
      genSlowRate
    );
    setUploading(false);
    setUploadName('');
    setSelectedFile(null);
    setGenModalVisible(false);
    await loadSongs();
  };

  const openRegenModal = (song: SongData) => {
    setTargetSong(song);
    setRegenPrompt('');
    setRegenKey(4);
    setRegenSlowRate(1.0);
    setModalVisible(true);
  };

  const handleRegen = async () => {
    if (!targetSong) return;
    setRegenLoading(true);
      await regenerateChart(
      targetSong.song_id,
      regenPrompt,
      regenKey,
      regenSlowRate      
    );
    setRegenLoading(false);
    setModalVisible(false);
    await loadSongs();
  };

  return (
  <div className="flex items-center justify-center w-full h-screen bg-gray-100">
    <div className="w-[360px] h-[640px] bg-white rounded-lg shadow-lg p-4 flex flex-col">
      <h2 className="text-2xl font-semibold mb-4 text-center">Select Song</h2>

      <div className="flex justify-center mb-4 space-x-2">
        {[4,5,6].map(k => (
          <button
            key={k}
            onClick={() => setKeyMode(k as 4|5|6)}
            className={`px-3 py-1 rounded ${keyMode === k ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            {k}-Keys
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto mb-4">
        {filtered.length > 0 ? (
          <ul className="space-y-2">
            {filtered.map(song => (
              <li key={song.song_id} className="flex justify-between items-center">
                <button
                  onClick={() => handlePlay(song)}
                  className="flex-1 text-left px-3 py-2 bg-gray-100 rounded hover:bg-blue-50"
                >
                  {song.original_name}
                </button>
                <button
                  onClick={() => openRegenModal(song)}
                  className="ml-2 text-sm px-2 py-1 bg-yellow-400 text-black rounded hover:bg-yellow-500"
                >
                  ↻
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-center text-gray-500">No songs available for {keyMode}-Keys</p>
        )}
      </div>

      <div className="flex flex-col space-y-2">
        <input
          type="text"
          value={uploadName}
          onChange={e => setUploadName(e.target.value)}
          placeholder="Song Name (optional)"
          className="px-2 py-1 border rounded"
        />
        <label className="flex justify-center items-center px-4 py-2 bg-green-500 text-white rounded cursor-pointer">
          {uploading ? 'Generating...' : 'Upload & Generate'}
          <input type="file" accept="audio/*" onChange={handleFileChange} className="hidden" />
        </label>
      </div>

      {/* Regenerate Chart Modal */}
{modalVisible && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white p-4 rounded shadow w-80">
      {/* Header with small gray “Delete Song” link */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold">Regenerate Chart</h3>
        <button
          onClick={async () => {
            if (!targetSong) return;
            await deleteSong(targetSong.song_id);
            setModalVisible(false);
            await loadSongs();
          }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Delete Song
        </button>
      </div>

      {/* Prompt textarea */}
      <textarea
        value={regenPrompt}
        onChange={e => setRegenPrompt(e.target.value)}
        className="w-full h-20 border rounded p-1 mb-3"
        placeholder="Additional prompt (optional)"
      />

      {/* Slow‐rate slider */}
      <div className="mb-4">
        <label className="block text-sm mb-1">
          Slow Rate: {regenSlowRate.toFixed(2)}
        </label>
        <input
          type="range"
          min={0.25}
          max={1.0}
          step={0.01}
          value={regenSlowRate}
          onChange={e => setRegenSlowRate(parseFloat(e.target.value))}
          className="w-full"
        />
        <p className="text-xs text-gray-500 mt-1">
          Accuracy improvement on fast songs (experimental)
        </p>
      </div>

      {/* Key‐mode buttons */}
      <div className="flex justify-center space-x-2 mb-4">
        {[4, 5, 6].map(k => (
          <button
            key={k}
            onClick={() => setRegenKey(k as 4|5|6)}
            className={`px-3 py-1 rounded ${
              regenKey === k
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            {k}-Keys
          </button>
        ))}
      </div>

      {/* Cancel & Regenerate */}
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => setModalVisible(false)}
          className="px-3 py-1 bg-gray-300 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleRegen}
          className="px-3 py-1 bg-blue-500 text-white rounded"
        >
          {regenLoading ? 'Regenerating...' : 'Regenerate'}
        </button>
      </div>
    </div>
  </div>
)}


      {/* Generate Chart Modal */}
      {genModalVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded shadow w-80">
            <h3 className="text-lg font-semibold mb-2">Generate Chart</h3>
            <textarea
              value={genPrompt}
              onChange={e => setGenPrompt(e.target.value)}
              className="w-full h-20 border rounded p-1 mb-2"
              placeholder="Additional prompt (optional)"
            />
            <div className="mb-2">
              <label className="block text-sm mb-1">
                Slow Rate: {genSlowRate.toFixed(2)}
              </label>
              <input
                type="range"
                min={0.25}
                max={1.0}
                step={0.01}
                value={genSlowRate}
                onChange={e => setGenSlowRate(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                Accuracy improvement on fast songs (experimental)
              </p>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setGenModalVisible(false)}
                className="px-3 py-1 bg-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="px-3 py-1 bg-green-500 text-white rounded"
              >
                {uploading ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
);
};

export default SongSelect;