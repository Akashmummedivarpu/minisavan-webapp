import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useRoomStore } from '../store';
import { socket } from '../socket';
import { Users, Send, Disc, ArrowLeft, ListMusic, Radio, Copy, Check, UserPlus, UserCheck, UserX, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import AuthModal from '../components/AuthModal';
import { RoomDashboardSkeleton } from '../components/SkeletonLoader';

// Allowed reactions per PRD
const REACTIONS = ['❤️', '🔥', '😂', '😍', '👏', '😮', '🎵', '🎉'];

export default function RoomDashboard() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentSong, isPlaying, listeners, messages, sendChatMessage, leaveRoom, roomId: activeRoomId, user, joinRoom, roomQueue, joinError, roomNotice, clearRoomNotice, roomMeta, roomRole, pendingRequests, joinRequested, approveJoinRequest, denyJoinRequest } = useRoomStore();
  const [chatInput, setChatInput] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isJoining, setIsJoining] = useState(true);
  const [reactionBarVisible, setReactionBarVisible] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // If not logged in, prompt them
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    // If logged in but not in this room, join it automatically.
    // A ?code= param carries an invite code (join-by-code links).
    if (activeRoomId !== roomId && roomId) {
      setIsJoining(true);
      joinRoom(roomId, searchParams.get('code') || undefined);
    } else {
      setIsJoining(false);
    }
  }, [user, activeRoomId, roomId, joinRoom, searchParams]);

  // A failed join must not leave the user staring at a skeleton forever
  useEffect(() => {
    if (joinError) setIsJoining(false);
  }, [joinError]);

  // Room ended while inside (or notice set): inform + take user back to rooms
  useEffect(() => {
    if (roomNotice) {
      toast.error(roomNotice);
      clearRoomNotice();
      navigate('/rooms');
    }
  }, [roomNotice, clearRoomNotice, navigate]);

  useEffect(() => {
    // Scroll to bottom of chat
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      sendChatMessage(chatInput);
      setChatInput('');
    }
  };

  const handleLeave = () => {
    leaveRoom();
    navigate('/rooms');
  };

  const handleSendReaction = (emoji: string) => {
    if (roomId) {
      socket.emit('room:reaction', { roomId, emoji });
      setReactionBarVisible(false);
    }
  };

  const handleCopyCode = async () => {
    const code = roomMeta?.inviteCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — fall back
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  if (!user) {
    return (
      <div className="w-full">
        <RoomDashboardSkeleton />
        <AuthModal isOpen={showAuthModal} onClose={() => navigate('/rooms')} />
      </div>
    );
  }

  // A failed join shows an explanatory error instead of an endless skeleton
  // (checked independently: isJoining is already false once joinError arrives)
  if (joinError && activeRoomId !== roomId) {
    return (
      <div className="w-full flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5">
          <Radio size={28} className="text-secondary" />
        </div>
        <h2 className="text-xl font-bold mb-2">Couldn't join this room</h2>
        <p className="text-secondary text-sm mb-6 max-w-xs">{joinError}</p>
        <button
          onClick={() => navigate('/rooms')}
          className="bg-white text-black font-bold py-3 px-6 rounded-xl text-sm hover:scale-105 transition-transform"
        >
          Browse Rooms
        </button>
      </div>
    );
  }

  // Approval-required room: request filed, waiting on the host
  if (joinRequested && activeRoomId !== roomId) {
    return (
      <div className="w-full flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-5">
          <UserPlus size={28} className="text-accent animate-pulse" />
        </div>
        <h2 className="text-xl font-bold mb-2">Request sent</h2>
        <p className="text-secondary text-sm mb-6 max-w-xs">
          The host has been notified. You'll join automatically once approved — no need to stay on this page.
        </p>
        <div className="flex items-center gap-2 text-secondary text-sm mb-6">
          <Loader2 size={16} className="animate-spin" /> Waiting for approval…
        </div>
        <button
          onClick={() => navigate('/rooms')}
          className="bg-white/10 text-white font-bold py-3 px-6 rounded-xl text-sm hover:bg-white/20 transition-colors"
        >
          Browse Rooms
        </button>
      </div>
    );
  }

  if (isJoining) {
    return (
      <div className="w-full">
        <RoomDashboardSkeleton />
        <AuthModal isOpen={showAuthModal} onClose={() => navigate('/rooms')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 w-full lg:h-[calc(100vh-180px)] pb-32 lg:pb-0">
      
      {/* Main Stage */}
      <div className="flex-1 glass-panel rounded-[32px] overflow-hidden relative flex flex-col p-4 md:p-8 items-center justify-center border border-white/10 shadow-2xl min-h-[240px] md:min-h-[480px]">
        <button 
          onClick={handleLeave}
          className="absolute top-4 left-4 md:top-6 md:left-6 flex items-center gap-2 text-white/70 hover:text-white transition-colors bg-black/40 px-3 md:px-4 py-2 rounded-full font-medium text-sm backdrop-blur-md z-10"
        >
          <ArrowLeft size={16} /> Leave
        </button>

        <div className="absolute top-4 right-4 md:top-6 md:right-6 flex items-center gap-2 text-white/90 bg-accent/20 border border-accent/30 px-3 md:px-4 py-2 rounded-full font-medium text-sm backdrop-blur-md shadow-[0_0_15px_rgba(34,197,94,0.3)] z-10">
          <Users size={16} /> {listeners} {listeners === 1 ? 'Listener' : 'Listeners'}
        </div>

        {roomMeta?.inviteCode && (
          <button
            onClick={handleCopyCode}
            title="Copy invite code — share it so friends can join"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 md:bottom-6 flex items-center gap-2 text-white/80 hover:text-white transition-colors bg-black/40 px-3.5 py-2 rounded-full font-mono text-xs tracking-[0.2em] backdrop-blur-md border border-white/10 z-10"
          >
            {codeCopied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
            {codeCopied ? 'COPIED' : roomMeta.inviteCode}
          </button>
        )}

        {currentSong ? (
          <div className="flex flex-col items-center animate-in zoom-in duration-500 w-full max-w-sm text-center pt-2 md:pt-8">
            <div className={`relative w-36 h-36 sm:w-56 sm:h-56 md:w-80 md:h-80 mb-4 md:mb-8 rounded-[28px] md:rounded-[40px] overflow-hidden shadow-2xl transition-transform duration-700 ${isPlaying ? 'scale-100' : 'scale-95 grayscale-[30%]'}`}>
              <img 
                src={currentSong.image || currentSong.image_url} 
                alt={currentSong.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 ring-1 ring-inset ring-white/20 rounded-[28px] md:rounded-[40px]"></div>
            </div>
            
            <h2 className="text-xl sm:text-2xl md:text-4xl font-extrabold tracking-tight mb-1.5 md:mb-3 line-clamp-1 w-full">
              {currentSong.title}
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-secondary font-medium line-clamp-1 w-full">
              {currentSong.artist}
            </p>

            {/* Reactions */}
            <div className="mt-3 md:mt-6">
              {reactionBarVisible ? (
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-3 rounded-full border border-white/10 animate-in fade-in zoom-in duration-200 flex-wrap justify-center">
                  {REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => handleSendReaction(emoji)}
                      className="text-xl hover:scale-125 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  onClick={() => setReactionBarVisible(true)}
                  className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-full text-sm font-bold transition-colors"
                >
                  React 🎉
                </button>
              )}
            </div>

            {/* Room Queue */}
            {roomQueue && roomQueue.length > 0 && (
              <div className="mt-4 md:mt-6 w-full max-w-sm">
                <h4 className="text-sm font-bold text-secondary mb-3 flex items-center gap-2">
                  <ListMusic size={16} /> Up Next ({roomQueue.length})
                </h4>
                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto scrollbar-hide">
                  {roomQueue.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-3 bg-white/5 rounded-xl p-2.5 border border-white/5">
                      <img 
                        src={item.track?.image || 'https://via.placeholder.com/150'} 
                        alt={item.track?.title || 'Song'} 
                        className="w-9 h-9 rounded-lg object-cover shrink-0"
                      />
                      <div className="overflow-hidden flex-1">
                        <p className="text-sm font-bold truncate">{item.track?.title || 'Unknown'}</p>
                        <p className="text-xs text-secondary truncate">{item.track?.artist || ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center text-secondary/60 animate-pulse pt-2 md:pt-8">
            <Disc size={80} className="mb-4 opacity-50" />
            <p className="text-lg font-medium">Waiting for the host to pick a song...</p>
          </div>
        )}
      </div>

      {/* Chat Sidebar */}
      <div className="w-full lg:w-[380px] h-[45vh] md:h-[420px] lg:h-full glass-panel rounded-[32px] flex flex-col border border-white/10 overflow-hidden shadow-2xl">
        {(roomRole === 'ADMIN' || roomRole === 'CONTROLLER') && pendingRequests.length > 0 && (
          <div className="p-4 md:p-5 border-b border-accent/20 bg-accent/5">
            <h4 className="font-bold text-sm flex items-center gap-2 mb-3">
              <UserPlus size={16} className="text-accent" />
              Join Requests ({pendingRequests.length})
            </h4>
            <div className="flex flex-col gap-2 max-h-36 overflow-y-auto scrollbar-hide">
              {pendingRequests.map((req: any) => (
                <div key={req.userId} className="flex items-center justify-between gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                  <span className="text-sm font-bold truncate">{req.username || 'Someone'}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => approveJoinRequest(req.userId)}
                      title={`Approve ${req.username || 'user'}`}
                      className="p-2 bg-accent/20 text-accent rounded-full hover:bg-accent/30 transition-colors"
                    >
                      <UserCheck size={15} />
                    </button>
                    <button
                      onClick={() => denyJoinRequest(req.userId)}
                      title={`Deny ${req.username || 'user'}`}
                      className="p-2 bg-red-500/15 text-red-400 rounded-full hover:bg-red-500/25 transition-colors"
                    >
                      <UserX size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="p-4 md:p-5 border-b border-white/5 bg-white/5 backdrop-blur-md">
          <h3 className="font-bold text-lg flex items-center gap-2">
            Live Chat
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-secondary/50 text-sm italic">
              It's quiet here. Say hello!
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className="flex flex-col animate-in slide-in-from-bottom-2 fade-in duration-300">
                <span className="text-xs font-bold text-white/50 mb-1 ml-1">{msg.username}</span>
                <div className="bg-white/10 backdrop-blur-md w-fit max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm border border-white/5 break-words">
                  {msg.message}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="p-3 md:p-4 bg-black/20 border-t border-white/5">
          <div className="relative flex items-center">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Type a message..."
              className="w-full bg-white/5 border border-white/10 rounded-full pl-5 pr-12 py-3 md:py-3.5 text-sm text-white focus:outline-none focus:border-accent/50 transition-colors"
            />
            <button 
              type="submit"
              disabled={!chatInput.trim()}
              className="absolute right-2 p-2 bg-accent text-black rounded-full hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
