import React, { useState, useEffect, useRef } from 'react';
import { ref, push, onValue, limitToLast, query } from 'firebase/database';
import { db } from '../firebase';

const Chat = ({ user }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    const chatRef = query(ref(db, 'chat'), limitToLast(50));
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        setMessages(Object.values(snapshot.val()));
      } else {
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMessage = {
      uid: user.uid,
      nickname: user.nickname,
      color: user.color,
      text: inputText,
      timestamp: Date.now()
    };

    push(ref(db, 'chat'), newMessage);
    setInputText('');
  };

  return (
    <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>💬 실시간 채팅</span>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 20 }}>아직 메시지거 없습니다.</p>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} style={{ animation: 'fadeIn 0.3s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontWeight: 800, fontSize: '0.8rem', color: msg.color }}>{msg.nickname}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ 
                background: msg.uid === user.uid ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)', 
                padding: '8px 12px', 
                borderRadius: '0 12px 12px 12px', 
                fontSize: '0.9rem', 
                lineHeight: '1.4',
                border: '1px solid rgba(255,255,255,0.05)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}>
                {msg.text}
              </div>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={sendMessage} style={{ padding: 12, borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input 
            type="text" 
            placeholder="메시지 입력..." 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            style={{ flex: 1, background: 'rgba(0,0,0,0.2)', height: 40 }}
          />
          <button type="submit" style={{ height: 40, width: 60, padding: 0 }}>전송</button>
        </div>
      </form>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
};

export default Chat;
