import type { Timestamp } from 'firebase/firestore';

export type UserStatus = 'pending' | 'approved' | 'rejected' | 'banned';
export type MarkerStatus = 'pending' | 'approved' | 'rejected' | 'removed';
export type ComplaintStatus = 'open' | 'resolved' | 'dismissed';

export interface UserProfile {
  uid: string;
  username: string;
  usernameLower: string;
  fullName: string;
  email: string;
  phone: string;
  status: UserStatus;
  createdAt: Timestamp | null;
  consents: {
    dataProcessing: boolean;
    privacyPolicy: boolean;
    version: string;
    acceptedAt: Timestamp | null;
  };
  rejectReason?: string;
}

export interface MapMarker {
  id: string;
  title: string;
  caption: string;
  lat: number;
  lng: number;
  ownerId: string;
  status: MarkerStatus;
  createdAt: Timestamp | null;
  rejectReason?: string;
}

export interface Complaint {
  id: string;
  markerId: string;
  text: string;
  authorId: string;
  status: ComplaintStatus;
  createdAt: Timestamp | null;
}
