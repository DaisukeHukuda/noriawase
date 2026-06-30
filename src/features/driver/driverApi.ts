import type { SupabaseClient } from '@supabase/supabase-js';

export type DriverProfile = {
  id: string;
  vehicle_model: string | null;
  license_plate: string | null;
  insurance_confirmed: boolean;
};

export type DriverInput = {
  vehicleModel: string;
  licensePlate: string;
  insuranceConfirmed: boolean;
};

export async function getDriverProfile(
  client: SupabaseClient,
  userId: string,
): Promise<DriverProfile | null> {
  const { data, error } = await client
    .from('driver_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as DriverProfile) ?? null;
}

export async function saveDriverProfile(
  client: SupabaseClient,
  userId: string,
  input: DriverInput,
): Promise<DriverProfile> {
  const { data, error } = await client
    .from('driver_profiles')
    .upsert({
      id: userId,
      vehicle_model: input.vehicleModel,
      license_plate: input.licensePlate,
      insurance_confirmed: input.insuranceConfirmed,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: pErr } = await client
    .from('profiles')
    .update({ is_driver: true })
    .eq('id', userId);
  if (pErr) throw pErr;

  return data as DriverProfile;
}
