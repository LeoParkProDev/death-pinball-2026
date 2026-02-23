'use client';

import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  isHost: boolean;
  isReady: boolean;
};

interface LobbyProps {
  onGameStart: (players: Player[], roomId: string, randomSeed: string, isHost: boolean) => void;
}

// ... (constants)
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
      .on('broadcast', { event: 'start_game' }, ({ payload }) => {
          // Everyone starts game with same seed
          // Note: Here isHostUser is false for guests
          onGameStart(payload.players, id, payload.seed, isHostUser);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            if (!isHostUser && initialPlayers.length > 0) {
                 channel.send({
                    type: 'broadcast',
                    event: 'join_request',
                    payload: { player: initialPlayers[0] }
                 });
            }
        }
      });

    channelRef.current = channel;
  };

  useEffect(() => {
      return () => {
          if (channelRef.current) supabase.removeChannel(channelRef.current);
      };
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
        isReady: true
    };
    setPlayers([me]);
    setMyPlayerId(newId);
    setupChannel(id, true, [me]);
    setView('lobby');
  };

  const joinRoom = () => {
    if (roomId.length !== 4) return;
    setIsHost(false);
    const newId = 'guest-' + Date.now();
    const me: Player = {
        id: newId,
        name: nickname || `Guest-${Math.floor(Math.random()*100)}`,
        color: '', 
        colorName: '',
        isHost: false,
        isReady: false
    };
    setMyPlayerId(newId);
    setupChannel(roomId, false, [me]);
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
        isReady: true
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

  const startGame = () => {
      const randomSeed = Math.random().toString(36).substring(7);
      if (channelRef.current) {
          channelRef.current.send({
              type: 'broadcast',
              event: 'start_game',
              payload: { players, seed: randomSeed }
          });
      }
      onGameStart(players, roomId, randomSeed, true); // I am Host
  };

  const allReady = players.length > 0 && players.every(p => p.isReady);
  const roomUrl = `${url}?room=${roomId}`;
  const myPlayer = players.find(p => p.id === myPlayerId);

  // --- Views ---
  if (view === 'home') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white font-sans p-4">
        <h1 className="text-5xl font-black mb-12 text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-yellow-500 tracking-tighter">DEATH PINBALL</h1>
        <div className="flex flex-col gap-4 w-full max-w-sm">
            <input type="text" placeholder="Enter Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} className="px-6 py-4 rounded-xl bg-gray-800 text-white text-lg text-center border-2 border-gray-700 focus:border-pink-500 focus:outline-none mb-4" maxLength={10} />
            <button onClick={generateRoomId} disabled={!nickname.trim()} className="py-4 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xl shadow-lg transition transform active:scale-95">Create Room</button>
            <button onClick={() => setView('join')} className="py-4 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl text-xl shadow-lg transition transform active:scale-95">Join Room</button>
        </div>
      </div>
    );
  }
  if (view === 'join') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white font-sans p-4">
        <h2 className="text-3xl font-bold mb-8">Enter Room ID</h2>
        <div className="w-full max-w-xs mb-4">
             <input type="text" placeholder="Enter Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full px-6 py-4 rounded-xl bg-gray-800 text-white text-lg text-center border-2 border-gray-700 focus:border-pink-500 focus:outline-none mb-4" maxLength={10} />
        </div>
        <div className="flex gap-2 mb-8">
            {[0, 1, 2, 3].map((i) => (<div key={i} className="w-14 h-20 bg-gray-800 border-2 border-gray-600 rounded-lg flex items-center justify-center text-4xl font-mono text-white">{roomId[i] || ''}</div>))}
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (<button key={num} onClick={() => roomId.length < 4 && setRoomId(roomId + num.toString())} className="w-20 h-20 bg-gray-800 hover:bg-gray-700 rounded-full text-2xl font-bold text-white transition active:bg-gray-600">{num}</button>))}
            <button onClick={() => setRoomId('')} className="w-20 h-20 bg-red-900/50 hover:bg-red-900/70 rounded-full text-lg font-bold text-red-200 transition">C</button>
            <button onClick={() => roomId.length < 4 && setRoomId(roomId + '0')} className="w-20 h-20 bg-gray-800 hover:bg-gray-700 rounded-full text-2xl font-bold text-white transition active:bg-gray-600">0</button>
             <button onClick={() => setRoomId(roomId.slice(0, -1))} className="w-20 h-20 bg-gray-800 hover:bg-gray-700 rounded-full text-xl font-bold text-white transition active:bg-gray-600 flex items-center justify-center">←</button>
        </div>
        <div className="flex gap-4">
            <button onClick={() => setView('home')} className="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold text-white">Back</button>
            <button onClick={joinRoom} disabled={roomId.length !== 4 || !nickname.trim()} className="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-xl shadow-lg transition transform active:scale-95">Enter</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white font-sans p-4">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-gray-800 p-8 rounded-2xl shadow-xl flex flex-col items-center text-center">
              <h2 className="text-gray-400 font-medium mb-2">ROOM ID</h2>
              <div className="text-6xl font-black tracking-widest text-white mb-8 font-mono">{roomId.split('').join(' ')}</div>
              <div className="bg-white p-4 rounded-xl mb-6"><QRCodeSVG value={roomUrl} size={200} /></div>
              <p className="text-sm text-gray-500 break-all px-4 mb-4">{roomUrl}</p>
              {isHost ? (<div className="flex flex-col gap-4 w-full"><p className="text-green-400 font-bold mb-2">You are the Host</p><button onClick={addBot} disabled={players.length >= 4} className="w-full py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-lg transition">+ Add Bot</button></div>) : (<div className="flex flex-col gap-4 w-full"><p className="text-yellow-400 font-bold mb-2">Waiting for host to start...</p><button onClick={toggleReady} disabled={!myPlayer} className={`w-full py-3 font-bold rounded-lg transition ${myPlayer?.isReady ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-600 hover:bg-gray-500 text-gray-200'}`}>{myPlayer?.isReady ? 'READY!' : 'Click to Ready'}</button></div>)}
          </div>
          <div className="bg-gray-800 p-8 rounded-2xl shadow-xl w-full flex flex-col justify-between">
              <div>
                <h3 className="text-2xl font-bold mb-6 flex justify-between items-center text-white">Players <span className="bg-gray-700 px-3 py-1 rounded-full text-sm">{players.length}/4</span></h3>
                <div className="space-y-4">
                    {[0, 1, 2, 3].map((index) => {
                    const player = players[index];
                    return (
                        <div key={index} className={`flex items-center p-4 rounded-xl transition-all duration-300 ${player ? 'bg-gray-700/50 border border-gray-600' : 'bg-gray-800/50 border border-dashed border-gray-700'}`}>
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mr-4 shadow-md shrink-0 relative" style={{ backgroundColor: player ? player.color : '#333' }}>
                            {player && <span className="text-xs font-bold text-black">{player.colorName[0]}</span>}
                            {player?.isReady && (<div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-800" />)}
                        </div>
                        <div className="flex-1">
                            {player ? (<div className="flex justify-between items-center"><span className="text-xl font-bold text-white truncate max-w-[120px]">{player.name}</span><div className="flex gap-2">{player.isHost && (<span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded font-bold">HOST</span>)}{player.isReady && (<span className="text-xs bg-green-500/20 text-green-500 px-2 py-1 rounded font-bold">READY</span>)}</div></div>) : (<span className="text-gray-600 italic">Empty Slot</span>)}
                        </div>
                        </div>
                    );
                    })}
                </div>
              </div>
              {isHost && (<button onClick={startGame} disabled={players.length < 2 || !allReady} className="mt-8 w-full py-4 bg-gradient-to-r from-pink-600 to-yellow-500 hover:from-pink-500 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xl shadow-lg transition transform active:scale-95">{players.length < 2 ? 'Need 2+ Players' : allReady ? 'START GAME' : 'Waiting for Ready...'}</button>)}
          </div>
      </div>
    </div>
  );
};
export default Lobby;