export type MembershipStatus = 'pending' | 'approved' | 'suspended';
export type MembershipRole = 'owner' | 'member';

export type Community = {
  id: string;
  name: string;
  invite_code: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type CommunityMembership = {
  id: string;
  community_id: string;
  user_id: string;
  status: MembershipStatus;
  role: MembershipRole;
  created_at: string;
  updated_at: string;
};

export type MyCommunity = {
  status: MembershipStatus;
  role: MembershipRole;
  community: Community;
};
