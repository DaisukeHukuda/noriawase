export type RideStatus = 'open' | 'matched' | 'completed' | 'cancelled';

export type RideRequest = {
  id: string;
  community_id: string;
  rider_id: string;
  depart_at: string;
  origin_text: string;
  destination_text: string;
  note: string | null;
  status: RideStatus;
  driver_id: string | null;
  created_at: string;
  updated_at: string;
};
