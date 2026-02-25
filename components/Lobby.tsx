'use client';

import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

export type CharacterType = 'normal' | 'teleport' | 'gravity';

export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isReady: boolean;
  character: CharacterType;
};

interface LobbyProps {
  onGameStart: (players: Player[], roomId: string, randomSeed: string, isHost: boolean, myPlayerId: string) => void;
}

const COLORS = [
  { code: '#ff4d4d', name: 'Red' },
  { code: '#4dff4d', name: 'Green' },
  { code: '#4d4dff', name: 'Blue' },
  { code: '#ffff4d', name: 'Yellow' },
];

const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

const CHARACTER_OPTIONS: { value: CharacterType; icon: string; title: string }[] = [
    { value: 'normal', icon: '⚪️', title: 'Normal' },
    { value: 'teleport', icon: '⚡️', title: 'Teleport (5s Swap)' },
    { value: 'gravity', icon: '🧲', title: 'Gravity (4s Shift)' },
];

const Lobby: React.FC<LobbyProps> = ({ onGameStart }) => {
  const [view, setView] = useState<'home' | 'create' | 'join' | 'lobby'>('home');
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [url, setUrl] = useState('');
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  
  const channelRef = useRef<RealtimeChannel | null>(null);

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

  useEffect(() => {
    if (!isHost || !channelRef.current || players.length === 0) return;
    if (channelRef.current.state === 'closed') return;

    channelRef.current.send({
      type: 'broadcast',
      event: 'update_players',
      payload: { players }
    });
  }, [players, isHost]);

  const setupChannel = (id: string, isHostUser: boolean, initialPlayers: Player[]) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`room:${id}`, {
      config: { broadcast: { self: true } },
    });

    channel
      .on('broadcast', { event: 'update_players' }, ({ payload }) => {
        if (!isHostUser) setPlayers(payload.players);
      })
      .on('broadcast', { event: 'join_request' }, ({ payload }) => {
        if (isHostUser) {
          setPlayers((prev) => {
            if (prev.length >= 4) return prev;
            if (prev.some(p => p.id === payload.player.id)) return prev;
            const newPlayer = {
              ...payload.player,
              color: COLORS[prev.length].code,
              colorName: COLORS[prev.length].name,
            };
            return [...prev, newPlayer];
          });
        }
      })
      .on('broadcast', { event: 'ready_change' }, ({ payload }) => {
        if (isHostUser) {
           setPlayers(prev => prev.map(p => 
               p.id === payload.id ? { ...p, isReady: payload.isReady } : p
           ));
        }
      })
      .on('broadcast', { event: 'character_change' }, ({ payload }) => {
        if (isHostUser) {
           setPlayers(prev => prev.map(p => 
               p.id === payload.id ? { ...p, character: payload.character } : p
           ));
        }
      })
      .on('broadcast', { event: 'start_game' }, ({ payload }) => {
          onGameStart(payload.players, id, payload.seed, isHostUser, myPlayerId);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            if (!isHostUser && initialPlayers.length > 0) {
                 channel.send({
                    type: 'broadcast',
                    event: 'join_request',
                    payload: { player: initialPlayers[0] }
                 });
            } else {
                if (players.length > 0) {
                    channel.send({
                        type: 'broadcast',
                        event: 'update_players',
                        payload: { players }
                    });
                }
            }
        }
      });

    channelRef.current = channel;
  };

  useEffect(() => {
      return () => {
          if (channelRef.current) {
              supabase.removeChannel(channelRef.current);
              channelRef.current = null;
          }
      };
  }, [myPlayerId]); 

  const generateRoomId = () => {
    const id = Math.floor(1000 + Math.random() * 9000).toString();
    const newId = 'host-' + Date.now();
    
    setRoomId(id);
    setIsHost(true);
    setMyPlayerId(newId);
    setNickname(prev => prev || 'Host');
    
    const me: Player = {
        id: newId,
        name: nickname || 'Host',
        color: COLORS[0].code,
        colorName: COLORS[0].name,
        isHost: true,
        isReady: true,
        character: 'normal'
    };
    setPlayers([me]);
    setupChannel(id, true, [me]);
    setView('lobby');
  };

  const joinRoom = () => {
    if (roomId.length !== 4) return;
    const newId = 'guest-' + Date.now();
    
    setIsHost(false);
    setMyPlayerId(newId);
    setNickname(prev => prev || `Guest-${Math.floor(Math.random()*100)}`);
    
    const me: Player = {
        id: newId,
        name: nickname || `Guest-${Math.floor(Math.random()*100)}`,
        color: '', 
        colorName: '', 
        isHost: false,
        isReady: true,
        character: 'normal'
    };

    setPlayers([]); 
    setupChannel(roomId, false, [me]);
    setView('lobby');
  };

  const addBot = () => {
      if (players.length >= 4) return;
      const randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      // Randomly assign a character to bot
      const randomChar = CHARACTER_OPTIONS[Math.floor(Math.random() * CHARACTER_OPTIONS.length)].value;

      const newPlayer: Player = {
        id: `bot-${Date.now()}-${Math.random()}`,
        name: `${randomName} (Bot)`,
        color: COLORS[players.length].code,
        colorName: COLORS[players.length].name,
        isHost: false,
        isReady: true,
        character: randomChar
      };
      setPlayers(prev => [...prev, newPlayer]);
  };

  const toggleReady = () => {
      const newReadyState = !players.find(p => p.id === myPlayerId)?.isReady;
      if (channelRef.current) {
          channelRef.current.send({
              type: 'broadcast',
              event: 'ready_change',
              payload: { id: myPlayerId, isReady: newReadyState }
          });
      }
  };

  const changeCharacter = (character: CharacterType) => {
      // Local optimistic update
      setPlayers(prev => prev.map(p => p.id === myPlayerId ? { ...p, character } : p));
      
      if (channelRef.current) {
          channelRef.current.send({
              type: 'broadcast',
              event: 'character_change',
              payload: { id: myPlayerId, character }
          });
      }
  };

  const startGame = () => {
      const randomSeed = Math.random().toString(36).substring(7);
      if (channelRef.current) {
          channelRef.current.send({
              type: 'broadcast',
              event: 'start_game',
              payload: { players, seed: randomSeed }
          });
      }
      onGameStart(players, roomId, randomSeed, true, myPlayerId);
  };

  const allReady = players.length > 0 && players.every(p => p.isReady);
  const roomUrl = `${url}?room=${roomId}`;
  const myPlayer = players.find(p => p.id === myPlayerId);

  // --- Views ---
  
  if (view === 'home') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gray-950 text-white font-sans p-6 overflow-hidden">
        <div className="w-full max-w-md flex flex-col items-center gap-8 animate-fade-in">
            <h1 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 tracking-tighter text-center leading-tight drop-shadow-2xl">
                DEATH PINBALL
            </h1>
            
            <div className="w-full bg-gray-900/50 backdrop-blur-md p-6 rounded-2xl border border-gray-800 shadow-2xl flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <label className="text-xs uppercase tracking-widest font-bold text-gray-400 ml-1">Nickname</label>
                    <input type="text" placeholder="Enter your name" value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full px-5 py-4 rounded-xl bg-gray-800 text-white text-lg placeholder-gray-500 border-2 border-transparent focus:border-pink-500 focus:bg-gray-800 focus:outline-none transition-all duration-200" maxLength={10} autoComplete="off"/>
                </div>

                <div className="grid grid-cols-1 gap-3 mt-2">
                    <button onClick={generateRoomId} disabled={!nickname.trim()} className="w-full py-4 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-lg shadow-lg shadow-pink-900/20 transition-all transform active:scale-[0.98]">Create Room</button>
                    <button onClick={() => setView('join')} className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white font-bold rounded-xl text-lg border border-gray-700 hover:border-gray-600 transition-all transform active:scale-[0.98]">Join Room</button>
                </div>
            </div>
        </div>
      </div>
    );
  }

  if (view === 'join') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gray-950 text-white font-sans p-4 pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-sm flex flex-col items-center">
            <h2 className="text-2xl font-bold mb-6 text-gray-300">Enter Room ID</h2>
            {!nickname && (
                <input type="text" placeholder="Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full mb-6 px-4 py-3 bg-gray-800 rounded-lg text-center text-white border border-gray-700 focus:border-pink-500 focus:outline-none" maxLength={10} autoComplete="off"/>
            )}
            <div className="flex justify-center gap-2 mb-8 w-full">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="w-14 h-16 md:w-16 md:h-20 bg-gray-900 border-b-4 border-gray-700 flex items-center justify-center text-3xl md:text-4xl font-mono text-pink-500 rounded-t-lg">{roomId[i] || ''}</div>
                ))}
            </div>
            <div className="grid grid-cols-3 gap-3 w-full max-w-[280px] mb-8">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button key={num} onClick={() => roomId.length < 4 && setRoomId(roomId + num.toString())} className="aspect-square w-full rounded-full bg-gray-800 hover:bg-gray-700 text-2xl font-semibold text-white transition active:bg-gray-600 flex items-center justify-center shadow-lg">{num}</button>
                ))}
                <button onClick={() => setRoomId('')} className="aspect-square w-full rounded-full bg-rose-900/30 text-rose-400 hover:bg-rose-900/50 font-semibold text-lg transition active:scale-95 flex items-center justify-center">CLR</button>
                <button onClick={() => roomId.length < 4 && setRoomId(roomId + '0')} className="aspect-square w-full rounded-full bg-gray-800 hover:bg-gray-700 text-2xl font-semibold text-white transition active:bg-gray-600 flex items-center justify-center shadow-lg">0</button>
                <button onClick={() => setRoomId(roomId.slice(0, -1))} className="aspect-square w-full rounded-full bg-gray-800 hover:bg-gray-700 text-white transition active:bg-gray-600 flex items-center justify-center shadow-lg">←</button>
            </div>
            <div className="flex gap-3 w-full">
                <button onClick={() => setView('home')} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 rounded-xl font-bold text-gray-300 transition">Back</button>
                <button onClick={joinRoom} disabled={roomId.length !== 4 || !nickname.trim()} className="flex-[2] py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg shadow-lg transition active:scale-[0.98]">Enter</button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gray-950 text-white font-sans p-4 pb-[env(safe-area-inset-bottom)] overflow-y-auto">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 my-auto">
          
          <div className="bg-gray-900 p-6 md:p-8 rounded-3xl border border-gray-800 shadow-2xl flex flex-col items-center text-center">
              <div className="flex flex-col items-center w-full">
                  <h2 className="text-gray-500 text-sm font-bold tracking-widest uppercase mb-2">Room Code</h2>
                  <div className="text-5xl md:text-6xl font-black tracking-[0.2em] text-white mb-6 font-mono bg-gray-800/50 px-6 py-2 rounded-xl border border-gray-700 w-full text-center">{roomId}</div>
                  <div className="bg-white p-2 md:p-3 rounded-xl mb-4 shadow-inner"><QRCodeSVG value={roomUrl} size={150} /></div>
                  <div className="bg-gray-800/50 rounded-lg p-3 w-full mb-6 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400 truncate flex-1 text-left font-mono">{roomUrl}</span>
                    <button onClick={() => navigator.clipboard.writeText(roomUrl)} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-white font-medium transition">Copy</button>
                  </div>
              </div>

              {isHost ? (
                  <div className="flex flex-col gap-3 w-full mt-auto">
                      <div className="text-green-400 text-sm font-bold bg-green-900/20 py-2 rounded-lg border border-green-900/50">YOU ARE HOST</div>
                      <button onClick={addBot} disabled={players.length >= 4} className="w-full py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-50 text-white font-bold rounded-xl transition text-sm uppercase tracking-wide">+ Add Bot</button>
                  </div>
              ) : (
                  <div className="flex flex-col gap-3 w-full mt-auto">
                       <button onClick={toggleReady} disabled={!myPlayer} className={`w-full py-4 font-black text-lg rounded-xl transition-all shadow-lg active:scale-[0.98] ${myPlayer?.isReady ? 'bg-green-500 text-white ring-4 ring-green-500/20' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{myPlayer?.isReady ? 'READY!' : 'TAP TO READY'}</button>
                  </div>
              )}
          </div>

          <div className="bg-gray-900 p-6 md:p-8 rounded-3xl border border-gray-800 shadow-2xl flex flex-col h-full">
              <div className="flex justify-between items-end mb-6">
                <h3 className="text-2xl font-bold text-white">Players</h3>
                <span className="bg-gray-800 text-gray-400 px-3 py-1 rounded-full text-sm font-mono border border-gray-700">{players.length} / 4</span>
              </div>
              
              <div className="space-y-3 flex-1 overflow-y-auto min-h-[200px]">
                  {[0, 1, 2, 3].map((index) => {
                    const player = players[index];
                    const isMe = player?.id === myPlayerId;

                    return (
                        <div key={index} className={`flex items-center p-3 rounded-2xl transition-all duration-300 border ${player ? 'bg-gray-800/80 border-gray-700 shadow-sm' : 'bg-gray-900/30 border-dashed border-gray-800'}`}>
                            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center mr-4 shadow-sm shrink-0 relative transition-transform" style={{ backgroundColor: player ? player.color : '#1f2937' }}>
                                {player && <span className="text-xs font-black text-black/80">{player.colorName[0]}</span>}
                                {player?.isReady && (<div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-4 border-gray-800" />)}
                            </div>
                            
                            <div className="flex-1 min-w-0 flex flex-col justify-center"> 
                                {player ? (
                                    <div className="flex justify-between items-center gap-2">
                                        <span className="text-lg font-bold text-white truncate">{player.name}</span>
                                        
                                        <div className="flex items-center gap-2">
                                            {/* Character Selection (Only for myself) */}
                                            {isMe ? (
                                                <div className="flex bg-gray-900 rounded-lg overflow-hidden border border-gray-700 mr-2">
                                                    {CHARACTER_OPTIONS.map(opt => (
                                                        <button 
                                                            key={opt.value}
                                                            title={opt.title}
                                                            onClick={() => changeCharacter(opt.value)}
                                                            className={`w-8 h-8 flex items-center justify-center transition-colors ${player.character === opt.value ? 'bg-pink-600/50' : 'hover:bg-gray-800'}`}
                                                        >
                                                            {opt.icon}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 mr-2" title={CHARACTER_OPTIONS.find(c => c.value === player.character)?.title}>
                                                    {CHARACTER_OPTIONS.find(c => c.value === player.character)?.icon}
                                                </div>
                                            )}

                                            {player.isHost && (
                                                <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded font-bold border border-yellow-500/20 shrink-0">HOST</span>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-gray-600 text-sm font-medium italic">Empty Slot</span>
                                )}
                            </div>
                        </div>
                    );
                  })}
              </div>

              {isHost && (
                  <button onClick={startGame} disabled={players.length < 2 || !allReady} className="mt-6 w-full py-4 bg-gradient-to-r from-pink-600 to-orange-500 hover:from-pink-500 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:grayscale text-white font-black rounded-xl text-xl shadow-lg shadow-orange-900/20 transition-all transform active:scale-[0.98]">
                      {players.length < 2 ? 'WAITING FOR PLAYERS...' : allReady ? 'START GAME' : 'WAITING FOR READY...'}
                  </button>
              )}
          </div>
      </div>
    </div>
  );
};
export default Lobby;