import React, { useState, useEffect, useRef, memo } from 'react';
import { ref, push, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase';

const Chat = ({ user }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [ip, setIp] = useState('0.0.0.0');
  const messagesEndRef = useRef(null);

  // 접속 시 공인 IP 가져오기
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(res => res.json())
      .then(data => {
        // IP 마스킹 (ex: 121.162.xx.xx)
        const parts = data.ip.split('.');
        if (parts.length === 4) {
          setIp(`${parts[0]}.${parts[1]}.${parts[2]}.**`);
        } else {
          setIp(data.ip);
        }
      })
      .catch(err => console.error('IP fetching error:', err));
  }, []);

  // 채팅 리스트 실시간 동기화
  useEffect(() => {
    const chatRef = ref(db, 'chat');
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgList = Object.keys(data).map(key => ({
          id: key,
          ...data[key]
        })).sort((a, b) => a.timestamp - b.timestamp);
        
        // 너무 많은 채팅 유지 방지 (최근 100개만 표시)
        setMessages(msgList.slice(-100));
      } else {
        setMessages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    push(ref(db, 'chat'), {
      uid: user.uid,
      nickname: user.nickname,
      ip: ip,
      text: inputText,
      timestamp: serverTimestamp(),
      color: user.color
    });
    setInputText('');
  };

  return (
    <div className="panel" style={{ gridArea: 'chat' }}>
      <div className="panel-header">실시간 채팅</div>
      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginRight: 4 }}>
              [{msg.ip}]
            </span>
            <strong style={{ color: msg.color || 'var(--text-main)', marginRight: 6 }}>
              {msg.nickname}:
            </strong>
            <span style={{ wordBreak: 'break-word', lineHeight: 1.4 }}>{msg.text}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ padding: 16, borderTop: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
        <form onSubmit={handleSend} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="메시지를 입력하세요..."
            style={{ flex: 1 }}
          />
          <button type="submit">전송</button>
        </form>
      </div>
    </div>
  );
};

export default memo(Chat);
