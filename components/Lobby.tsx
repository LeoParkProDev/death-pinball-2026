'use client';

import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isReady: boolean;
};

interface LobbyProps {
  onGameStart: (players: Player[]) => void;
}

const COLORS = [
  { code: '#ff4d4d', name: 'Red' },
  { code: '#4dff4d', name: 'Green' },
  { code: '#4d4dff', name: 'Blue' },
  { code: '#ffff4d', name: 'Yellow' },
];

const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

const Lobby: React.FC<LobbyProps> = ({ onGameStart }) => {
  const [view, setView] = useState<'home' | 'create' | 'join' | 'lobby'>('home');
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [url, setUrl] = useState('');
  
  // Track my own player ID to update ready state
  const [myPlayerId, setMyPlayerId] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      setUrl(window.location.origin);
      
      if (roomParam) {
        setRoomId(roomParam);
        setView('join');
      }
    }
  }, []);

  const generateRoomId = () => {
    const id = Math.floor(1000 + Math.random() * 9000).toString();
    setRoomId(id);
    setIsHost(true);
    
    const newId = 'host-' + Date.now();
    const me: Player = {
        id: newId,
        name: nickname || 'Host',
        color: COLORS[0].code,
        colorName: COLORS[0].name,
        isHost: true,
        isReady: true // Host is always ready
    };
    setPlayers([me]);
    setMyPlayerId(newId);
    setView('lobby');
  };

  const joinRoom = () => {
    if (roomId.length !== 4) return;
    setIsHost(false);
    
    // In real app, we would fetch existing players
    // Here we just simulate joining as 2nd player
    const newId = 'guest-' + Date.now();
    const me: Player = {
        id: newId,
        name: nickname || `Guest-${Math.floor(Math.random()*100)}`,
        color: COLORS[1].code,
        colorName: COLORS[1].name,
        isHost: false,
        isReady: false // Guest starts unready
    };
    setPlayers([me]); 
    setMyPlayerId(newId);
    setView('lobby');
  };

  const addBot = () => {
      if (players.length >= 4) return;
      
      const randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      const newPlayer: Player = {
        id: `bot-${Date.now()}-${Math.random()}`,
        name: `${randomName} (Bot)`,
        color: COLORS[players.length].code,
        colorName: COLORS[players.length].name,
        isHost: false,
        isReady: true // Bots are always ready
      };
      setPlayers(prev => [...prev, newPlayer]);
  };

  const toggleReady = () => {
      setPlayers(prev => prev.map(p => 
          p.id === myPlayerId ? { ...p, isReady: !p.isReady } : p
      ));
  };

  // Check if all players are ready
  const allReady = players.length > 0 && players.every(p => p.isReady);


  // --- Views ---

  if (view === 'home') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white font-sans p-4">
        <h1 className="text-5xl font-black mb-12 text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-yellow-500 tracking-tighter">
          DEATH PINBALL
        </h1>
        
        <div className="flex flex-col gap-4 w-full max-w-sm">
            <input
                type="text"
                placeholder="Enter Nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="px-6 py-4 rounded-xl bg-gray-800 text-white text-lg text-center border-2 border-gray-700 focus:border-pink-500 focus:outline-none mb-4"
                maxLength={10}
            />

            <button
                onClick={generateRoomId}
                disabled={!nickname.trim()}
                className="py-4 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xl shadow-lg transition transform active:scale-95"
            >
                Create Room
            </button>
            
            <button
                onClick={() => setView('join')}
                className="py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl text-xl shadow-lg transition transform active:scale-95"
            >
                Join Room
            </button>
        </div>
      </div>
    );
  }

  if (view === 'join') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white font-sans p-4">
        <h2 className="text-3xl font-bold mb-8">Enter Room ID</h2>
        
        <div className="w-full max-w-xs mb-4">
             <input
                type="text"
                placeholder="Enter Nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-6 py-4 rounded-xl bg-gray-800 text-white text-lg text-center border-2 border-gray-700 focus:border-pink-500 focus:outline-none mb-4"
                maxLength={10}
            />
        </div>

        <div className="flex gap-2 mb-8">
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className="w-14 h-20 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-4xl font-mono text-white">
                    {roomId[i] || ''}
                </div>
            ))}
        </div>

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-4 mb-8">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                    key={num}
                    onClick={() => roomId.length < 4 && setRoomId(roomId + num.toString())}
                    className="w-20 h-20 bg-gray-800 hover:bg-gray-700 rounded-full text-2xl font-bold text-white transition active:bg-gray-600"
                >
                    {num}
                </button>
            ))}
            <button
                 onClick={() => setRoomId('')} // Clear all
                 className="w-20 h-20 bg-red-900/50 hover:bg-red-900/70 rounded-full text-lg font-bold text-red-200 transition"
            >
                C
            </button>
            <button
                onClick={() => roomId.length < 4 && setRoomId(roomId + '0')}
                className="w-20 h-20 bg-gray-800 hover:bg-gray-700 rounded-full text-2xl font-bold text-white transition active:bg-gray-600"
            >
                0
            </button>
             <button
                 onClick={() => setRoomId(roomId.slice(0, -1))} // Backspace
                 className="w-20 h-20 bg-gray-800 hover:bg-gray-700 rounded-full text-xl font-bold text-white transition active:bg-gray-600 flex items-center justify-center"
            >
                ←
            </button>
        </div>

        <div className="flex gap-4">
            <button
                onClick={() => setView('home')}
                className="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold text-white"
            >
                Back
            </button>
            <button
                onClick={joinRoom}
                disabled={roomId.length !== 4 || !nickname.trim()}
                className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xl shadow-lg transition transform active:scale-95"
            >
                Enter
            </button>
        </div>
      </div>
    );
  }

  // Lobby View
  const roomUrl = `${url}?room=${roomId}`;
  const myPlayer = players.find(p => p.id === myPlayerId);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white font-sans p-4">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Left: Room Info & QR */}
          <div className="bg-gray-800 p-8 rounded-2xl shadow-xl flex flex-col items-center text-center">
              <h2 className="text-gray-400 font-medium mb-2">ROOM ID</h2>
              <div className="text-6xl font-black tracking-widest text-white mb-8 font-mono">
                  {roomId.split('').join(' ')}
              </div>

              <div className="bg-white p-4 rounded-xl mb-6">
                  <QRCodeSVG value={roomUrl} size={200} />
              </div>
              
              <p className="text-sm text-gray-500 break-all px-4 mb-4">
                  {roomUrl}
              </p>

              {isHost ? (
                   <div className="flex flex-col gap-4 w-full">
                       <p className="text-green-400 font-bold mb-2">
                           You are the Host
                       </p>
                       <button
                            onClick={addBot}
                            disabled={players.length >= 4}
                            className="w-full py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-lg transition"
                       >
                           + Add Bot
                       </button>
                   </div>
              ) : (
                  <div className="flex flex-col gap-4 w-full">
                      <p className="text-yellow-400 font-bold mb-2">
                          Waiting for host to start...
                      </p>
                      <button
                            onClick={toggleReady}
                            className={`w-full py-3 font-bold rounded-lg transition ${
                                myPlayer?.isReady 
                                ? 'bg-green-600 hover:bg-green-500 text-white' 
                                : 'bg-gray-600 hover:bg-gray-500 text-gray-200'
                            }`}
                       >
                           {myPlayer?.isReady ? 'READY!' : 'Click to Ready'}
                       </button>
                  </div>
              )}
          </div>

          {/* Right: Players List */}
          <div className="bg-gray-800 p-8 rounded-2xl shadow-xl w-full flex flex-col justify-between">
              <div>
                <h3 className="text-2xl font-bold mb-6 flex justify-between items-center text-white">
                    Players 
                    <span className="bg-gray-700 px-3 py-1 rounded-full text-sm">
                        {players.length}/4
                    </span>
                </h3>
                
                <div className="space-y-4">
                    {[0, 1, 2, 3].map((index) => {
                    const player = players[index];
                    return (
                        <div 
                        key={index}
                        className={`flex items-center p-4 rounded-xl transition-all duration-300 ${
                            player 
                            ? 'bg-gray-700/50 border border-gray-600' 
                            : 'bg-gray-800/50 border border-dashed border-gray-700'
                        }`}
                        >
                        <div 
                            className="w-12 h-12 rounded-full flex items-center justify-center mr-4 shadow-md shrink-0 relative"
                            style={{ backgroundColor: player ? player.color : '#333' }}
                        >
                            {player && <span className="text-xs font-bold text-black">{player.colorName[0]}</span>}
                            {player?.isReady && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-800" />
                            )}
                        </div>
                        
                        <div className="flex-1">
                            {player ? (
                            <div className="flex justify-between items-center">
                                <span className="text-xl font-bold text-white truncate max-w-[120px]">
                                    {player.name}
                                </span>
                                <div className="flex gap-2">
                                    {player.isHost && (
                                        <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded font-bold">
                                            HOST
                                        </span>
                                    )}
                                    {player.isReady && (
                                        <span className="text-xs bg-green-500/20 text-green-500 px-2 py-1 rounded font-bold">
                                            READY
                                        </span>
                                    )}
                                </div>
                            </div>
                            ) : (
                            <span className="text-gray-600 italic">Empty Slot</span>
                            )}
                        </div>
                        </div>
                    );
                    })}
                </div>
              </div>

              {isHost && (
                  <button 
                    onClick={() => onGameStart(players)}
                    disabled={players.length < 2 || !allReady}
                    className="mt-8 w-full py-4 bg-gradient-to-r from-pink-600 to-yellow-500 hover:from-pink-500 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xl shadow-lg transition transform active:scale-95"
                  >
                      {players.length < 2 ? 'Need 2+ Players' : allReady ? 'START GAME' : 'Waiting for Ready...'}
                  </button>
              )}
          </div>
      </div>
    </div>
  );
};

export default Lobby;