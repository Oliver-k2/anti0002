import React, { useState, useEffect } from 'react';
import { ref, onValue, set, update, remove, get } from 'firebase/database';
import { db } from './firebase';
import GameCanvas from './components/GameCanvas';
import Chat from './components/Chat';
import './index.css';

function App() {
  const [user, setUser] = useState(null); // { uid, nickname, color, status }
  const [inputName, setInputName] = useState('');
  const [adminMode, setAdminMode] = useState(false);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [resetTime, setResetTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState('00:00:00');
  
  // 관리자 비밀번호 관련 상태
  const [adminPassword, setAdminPassword] = useState(''); // DB에 저장된 비번
  const [passwordInput, setPasswordInput] = useState(''); // 입력창 비번
  const [isPasswordSet, setIsPasswordSet] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [newPassword, setNewPassword] = useState(''); // 신규 설정 비번

  useEffect(() => {
    const configRef = ref(db, 'config/resetTimer');
    const unsubscribe = onValue(configRef, (snapshot) => {
      if (snapshot.exists()) {
        setResetTime(snapshot.val());
      } else {
        // Initialize if not present (24H later)
        const nextTime = Date.now() + 24 * 60 * 60 * 1000;
        set(ref(db, 'config/resetTimer'), nextTime);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!resetTime) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const diff = resetTime - now;

      if (diff <= 0) {
        setTimeLeft('00:00:00');
        // Prevent continuous triggering by checking if it already refreshed
        if (Math.abs(diff) < 5000) { 
          handleResetData();
        }
      } else {
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
        const m = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
        const s = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
        setTimeLeft(`${h}:${m}:${s}`);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [resetTime]);

  const handleResetData = () => {
    const nextTime = Date.now() + 24 * 60 * 60 * 1000;
    const updates = {};
    updates['config/resetTimer'] = nextTime;
    updates['chat'] = null;
    updates['players'] = null;
    updates['tiles'] = null;
    update(ref(db), updates).catch(console.error);
    alert('맵과 채팅 데이터가 리셋되었습니다!');
  };

  useEffect(() => {
    // 관리자 비밀번호 설정 여부 확인
    const adminRef = ref(db, 'admin_config');
    onValue(adminRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.password) {
          setAdminPassword(data.password);
          setIsPasswordSet(true);
        } else {
          setIsPasswordSet(false);
        }
      } else {
        setIsPasswordSet(false);
      }
    });

    if (adminMode) {
      const approvalsRef = ref(db, 'approvals');
      const unsubscribe = onValue(approvalsRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const pending = Object.values(data).filter(u => u.status === 'pending');
          setPendingUsers(pending);
        } else {
          setPendingUsers([]);
        }
      });
      return () => unsubscribe();
    }
  }, [adminMode]);

  useEffect(() => {
    if (user && user.status === 'pending') {
      const userRef = ref(db, `approvals/${user.uid}`);
      const unsubscribe = onValue(userRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (data.status === 'approved') {
            setUser(prev => ({ ...prev, status: 'approved' }));
          }
        } else {
          setUser(null);
          alert("접속이 거절되었습니다.");
        }
      });
      return () => unsubscribe();
    }
  }, [user]);

  const handleLogin = (e) => {
    e.preventDefault();
    const name = inputName.trim();
    if (!name) return;

    if (name === '관리자') {
      if (isPasswordSet) {
        setShowPasswordPrompt(true);
      } else {
        // 비밀번호가 없으면 바로 입장
        setAdminMode(true);
      }
      return;
    }

    const randomColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`;
    const uid = 'uid_' + Math.random().toString(36).substr(2, 9);
    const newUser = { uid, nickname: name, color: randomColor, status: 'pending' };
    
    set(ref(db, `approvals/${uid}`), newUser)
      .then(() => {
        setUser(newUser);
      })
      .catch(err => console.error(err));
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === adminPassword) {
      setAdminMode(true);
      setShowPasswordPrompt(false);
      setPasswordInput('');
    } else {
      alert('비밀번호가 틀렸습니다.');
    }
  };

  const updateAdminPassword = () => {
    if (!newPassword.trim()) {
      alert('비밀번호를 입력하세요.');
      return;
    }
    update(ref(db, 'admin_config'), { password: newPassword.trim() })
      .then(() => {
        alert('관리자 비밀번호가 설정/변경되었습니다.');
        setNewPassword('');
      })
      .catch(console.error);
  };

  const approveUser = (uid) => {
    update(ref(db, `approvals/${uid}`), { status: 'approved' });
  };
  
  const rejectUser = (uid) => {
    remove(ref(db, `approvals/${uid}`));
  };

  // 관리자 모드
  const adminUser = { uid: 'admin_uid', nickname: '관리자', isAdmin: true, status: 'approved', color: '#ff0000' };

  if (adminMode) {
    return (
      <div style={{ color: 'white', padding: 20, width: '100%', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20, height: '100vh', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>관리자 제어판 🛠️ (리셋까지: {timeLeft})</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleResetData} style={{ backgroundColor: '#ef4444' }}>즉시 리셋 💣</button>
            <button onClick={() => { setAdminMode(false); setInputName(''); }} className="secondary">로그아웃</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
          <div style={{ width: '350px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
            {/* 비밀번호 설정 구역 */}
            <div className="panel" style={{ padding: 20 }}>
              <h3 style={{ marginBottom: 15 }}>비밀번호 관리</h3>
              <div style={{ display: 'flex', gap: 10 }}>
                <input 
                  type="password" 
                  placeholder="새 비밀번호 입력" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button onClick={updateAdminPassword}>저장</button>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                {isPasswordSet ? '비밀번호 설정됨' : '비밀번호 미설정 (권장)'}
              </p>
            </div>

            {/* 승인 대기열 */}
            <div className="panel" style={{ padding: 20 }}>
              <h3 style={{ marginBottom: 15 }}>접속 승인 대기열 ({pendingUsers.length})</h3>
              {pendingUsers.length === 0 ? <p>대기 중인 사용자가 없습니다.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {pendingUsers.map(u => (
                    <div key={u.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-color)', padding: 8, borderRadius: 8, border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 12, height: 12, background: u.color, borderRadius: '50%' }}></div>
                        <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{u.nickname}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => approveUser(u.uid)} style={{ padding: '6px 10px', fontSize: '0.8rem' }}>승인</button>
                        <button onClick={() => rejectUser(u.uid)} className="secondary" style={{ backgroundColor: '#ef4444', padding: '6px 10px', fontSize: '0.8rem' }}>거절</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative' }}>
            <GameCanvas user={adminUser} />
          </div>
        </div>
      </div>
    );
  }

  // 관리자 비밀번호 입력 폼
  if (showPasswordPrompt) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}>
        <form onSubmit={handlePasswordSubmit} style={{ background: 'var(--panel-bg)', padding: 40, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 20, width: 320, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          <h2 style={{ textAlign: 'center', color: 'white' }}>관리자 인증</h2>
          <input 
            type="password" 
            placeholder="비밀번호를 입력하세요" 
            value={passwordInput} 
            onChange={e => setPasswordInput(e.target.value)} 
            autoFocus 
            style={{ padding: '12px 16px', fontSize: '1rem' }}
          />
          <button type="submit" style={{ padding: '12px', fontSize: '1rem', fontWeight: 'bold' }}>입장하기</button>
          <button type="button" onClick={() => setShowPasswordPrompt(false)} className="secondary">취소</button>
        </form>
      </div>
    );
  }

  // 일반 로그인 폼
  if (!user) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}>
        <form onSubmit={handleLogin} style={{ background: 'var(--panel-bg)', padding: 40, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 20, width: 320, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          <h2 style={{ textAlign: 'center', color: 'white', marginBottom: 10 }}>🔥 픽셀 땅따먹기 🔥</h2>
          <input 
            type="text" 
            placeholder="닉네임 입력 (관리자로 가려면 '관리자' 입력)" 
            value={inputName} 
            onChange={e => setInputName(e.target.value)} 
            autoFocus 
            style={{ padding: '12px 16px', fontSize: '1rem' }}
          />
          <button type="submit" style={{ padding: '12px', fontSize: '1rem', fontWeight: 'bold' }}>접속 요청하기</button>
        </form>
      </div>
    );
  }

  // 대기 화면
  if (user.status === 'pending') {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ background: 'var(--panel-bg)', padding: 40, borderRadius: 12, textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          <h2>관리자 승인 대기중 ⏳</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>관리자가 승인하면 게임이 자동으로 시작됩니다.</p>
        </div>
      </div>
    );
  }

  // 게임 실행
  return (
    <div id="root">
      {/* 화면 우측 상단이나 헤더에 떠있는 시간 박스 */}
      <div style={{ position: 'absolute', top: 20, zIndex: 100, left: '50%', transform: 'translateX(-50%)', background: 'rgba(30,41,59,0.8)', padding: '8px 16px', borderRadius: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)', backdropFilter: 'blur(4px)' }}>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>리셋 타이머 ⏳</span>
        <strong style={{ marginLeft: 8, color: 'white', letterSpacing: 1 }}>{timeLeft}</strong>
      </div>
      <GameCanvas user={user} />
      <Chat user={user} />
    </div>
  );
}

export default App;
