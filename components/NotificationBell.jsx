import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { Bell, Check } from 'lucide-react';
import {
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
} from '../api';
import { fmtDateTime } from './UI';

/**
 * Notification bell shown in the sidebar. Polls for the current user's
 * unread count, and shows a dropdown list of recent notifications
 * (e.g. "NCR-003 assigned to you") when clicked. Clicking a notification
 * marks it read and navigates to its linked page.
 */
export default function NotificationBell({ userId }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  const { data: unread = { count: 0 } } = useQuery({
    queryKey: ['unreadCount', userId],
    queryFn:  () => getUnreadCount(userId),
    enabled:  !!userId,
    refetchInterval: 15000, // poll every 15s for new notifications
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', userId],
    queryFn:  () => getNotifications(userId),
    enabled:  !!userId && open,
  });

  const markReadMut = useMutation({
    mutationFn: (id) => markNotificationRead(id),
    onSuccess: () => { qc.invalidateQueries(['unreadCount', userId]); qc.invalidateQueries(['notifications', userId]); },
  });

  const markAllReadMut = useMutation({
    mutationFn: () => markAllNotificationsRead(userId),
    onSuccess: () => { qc.invalidateQueries(['unreadCount', userId]); qc.invalidateQueries(['notifications', userId]); },
  });

  // Close the dropdown when clicking outside it
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleNotificationClick(n) {
    if (!n.is_read) markReadMut.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{ position: 'relative' }}
      >
        <Bell size={16}/>
        {unread.count > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16,
            borderRadius: 8, background: 'var(--red)', color: '#fff',
            fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '0 3px', lineHeight: 1,
          }}>
            {unread.count > 9 ? '9+' : unread.count}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: '110%', left: 0, width: 320, maxHeight: 420,
          overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
          zIndex: 400,
        }}>
          <div className="flex-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Notifications</div>
            {unread.count > 0 && (
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => markAllReadMut.mutate()}>
                <Check size={11}/> Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-2)' }}>
              No notifications yet.
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  background: n.is_read ? 'transparent' : 'var(--accent-bg)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {!n.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginTop: 5, flexShrink: 0 }}/>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600 }}>{n.title}</div>
                    {n.message && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{n.message}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      {n.created_by ? `${n.created_by} · ` : ''}{fmtDateTime(n.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
