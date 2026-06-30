export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_driver: boolean;
};

export type ProfilePatch = Partial<Pick<Profile, 'full_name' | 'phone'>>;
