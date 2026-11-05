import { deleteField, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { withNetwork } from '../shared/errors';
import { db } from '../shared/firebase';
import type { Complaint, ComplaintStatus, MarkerStatus, UserProfile, UserStatus } from '../shared/types';

/** Отметка решения. Правила базы требуют, чтобы автором был сам модератор. */
const decision = (moderatorId: string, status: string, reason?: string) => ({
  status,
  reviewedBy: moderatorId,
  reviewedAt: serverTimestamp(),
  rejectReason: reason ? reason : deleteField(),
});

export const setUserStatus = (moderatorId: string, uid: string, status: UserStatus, reason?: string) =>
  withNetwork(() => updateDoc(doc(db, 'users', uid), decision(moderatorId, status, reason)));

export const setMarkerStatus = (moderatorId: string, id: string, status: MarkerStatus, reason?: string) =>
  withNetwork(() => updateDoc(doc(db, 'markers', id), decision(moderatorId, status, reason)));

export const setComplaintStatus = (moderatorId: string, id: string, status: ComplaintStatus) =>
  withNetwork(() => updateDoc(doc(db, 'complaints', id), decision(moderatorId, status)));

/** Блокировка закрывает и почту, чтобы нельзя было зарегистрироваться заново. */
export const banUser = (moderatorId: string, user: UserProfile, reason?: string) =>
  withNetwork(async () => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', user.uid), decision(moderatorId, 'banned', reason));
    batch.set(doc(db, 'blockedEmails', user.email), { uid: user.uid, blockedBy: moderatorId });
    await batch.commit();
  });

export const unbanUser = (moderatorId: string, user: UserProfile) =>
  withNetwork(async () => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', user.uid), decision(moderatorId, 'approved'));
    batch.delete(doc(db, 'blockedEmails', user.email));
    await batch.commit();
  });

/** Снимает метку с карты и закрывает все открытые жалобы на неё. */
export const removeMarkerAndResolve = (
  moderatorId: string,
  markerId: string,
  openComplaints: Complaint[],
  reason?: string,
) =>
  withNetwork(async () => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'markers', markerId), decision(moderatorId, 'removed', reason));
    for (const complaint of openComplaints) {
      if (complaint.markerId === markerId) {
        batch.update(doc(db, 'complaints', complaint.id), decision(moderatorId, 'resolved'));
      }
    }
    await batch.commit();
  });
