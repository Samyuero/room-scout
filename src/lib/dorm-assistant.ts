import { filterAndRankDorms } from '@/lib/dorm-discovery';
import type { Dorm, DormFilters, UserCoordinates } from '@/types/dorm';

export const DORM_ASSISTANT_SYSTEM_PROMPT = `You are Room Scout's dorm-finding assistant.
Use only the public dorm listing context supplied with the request.
Never expose or infer another user's identity, location, government ID, payment proof, contact details, preferences, or transaction history.
Do not invent availability, prices, amenities, certification, policies, reviews, or distances.
State clearly when information is missing and direct the user to verify terms with the owner before paying.
Rank recommendations by the app-provided score and explain them using price, public ratings, distance, and requested listing features.
Never ask the user to paste a government ID, payment credential, password, OTP, or private contract into chat.`;

/** The only shape that may be sent to a future hosted model. */
export function getAssistantListingContext(dorms: Dorm[]) {
  return dorms.map((dorm) => ({
    dorm_id: dorm.dorm_id,
    name: dorm.name,
    address: dorm.address,
    price: dorm.price,
    reservation_fee: dorm.reservation_fee,
    amenities: dorm.amenities,
    utilities: dorm.utilities,
    gender_policy: dorm.gender_policy,
    curfew: dorm.curfew,
    room_type: dorm.room_type,
    lgu_certified: dorm.lgu_certified,
    pet_friendly: dorm.pet_friendly,
    parking_info: dorm.parking_info,
    available_slots: dorm.available_slots,
    rating_average: dorm.rating_average,
    rating_count: dorm.rating_count,
    distance_km: dorm.distance_km,
    ranking_score: dorm.ranking_score,
  }));
}

interface AssistantResult {
  text: string;
  matches: Dorm[];
}

function numberFromMatch(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function findDormsFromPrompt(
  input: string,
  dorms: Dorm[],
  currentFilters: DormFilters,
  location: UserCoordinates | null,
): AssistantResult {
  const prompt = input.trim().slice(0, 500);
  const lower = prompt.toLowerCase();
  const budgetMatch = lower.match(/(?:under|below|max(?:imum)?|budget(?:\s+of)?|up to)\s*(?:₱|php)?\s*([\d,]+)/i);
  const radiusMatch = lower.match(/(?:within|under|around)\s*(\d+(?:\.\d+)?)\s*km/i);
  const filters: DormFilters = {
    ...currentFilters,
    query: '',
    amenities: [...currentFilters.amenities],
    utilities: [...currentFilters.utilities],
    parking: [...currentFilters.parking],
  };

  const budget = numberFromMatch(budgetMatch?.[1]);
  if (budget !== null) filters.maxPrice = budget;
  if (radiusMatch?.[1]) filters.radiusKm = Math.max(1, Math.min(50, Number(radiusMatch[1])));
  if (/pet|dog|cat/.test(lower)) filters.petFriendly = true;
  if (/lgu|certified|verified property/.test(lower)) filters.lguCertified = true;
  if (/motorcycle|motorbike/.test(lower)) filters.parking = ['Motorcycle'];
  else if (/\bcar\b|four wheel|4 wheel/.test(lower)) filters.parking = ['Car'];
  else if (/bicycle|bike parking/.test(lower)) filters.parking = ['Bicycle'];
  if (/female only|for women|for girls/.test(lower)) filters.genderPolicy = 'female';
  else if (/male only|for men|for boys/.test(lower)) filters.genderPolicy = 'male';
  else if (/co[- ]?ed|any gender/.test(lower)) filters.genderPolicy = 'co-ed';
  if (/wifi|wi-fi|internet/.test(lower) && !filters.amenities.includes('Wi-Fi')) filters.amenities.push('Wi-Fi');
  if (/air ?con|air conditioning/.test(lower) && !filters.amenities.includes('Air Conditioning')) filters.amenities.push('Air Conditioning');

  const ranked = filterAndRankDorms(dorms, filters, location).slice(0, 3);
  if (ranked.length === 0) {
    return {
      text: 'I could not find a public listing that matches every detail. Try a higher budget, larger radius, or fewer required amenities. I will never use another renter’s private information to fill the gap.',
      matches: [],
    };
  }

  const applied = [
    budget !== null ? `budget up to ₱${budget.toLocaleString('en-PH')}` : null,
    radiusMatch ? `${filters.radiusKm} km radius` : null,
    filters.lguCertified ? 'LGU certified' : null,
    filters.petFriendly ? 'pet friendly' : null,
    filters.parking[0] ? `${filters.parking[0]} parking` : null,
    filters.genderPolicy ? `${filters.genderPolicy} policy` : null,
  ].filter(Boolean);
  const first = ranked[0];
  const reason = [
    first.rating_count ? `${first.rating_average}/5 from ${first.rating_count} review${first.rating_count === 1 ? '' : 's'}` : 'a new listing without reviews yet',
    first.distance_km !== null ? `${first.distance_km} km away` : null,
    `₱${Math.round(first.price).toLocaleString('en-PH')} monthly`,
  ].filter(Boolean).join(', ');

  return {
    text: `I found ${ranked.length} match${ranked.length === 1 ? '' : 'es'}${applied.length ? ` for ${applied.join(', ')}` : ''}. ${first.name} ranks first because it has ${reason}. Verify the contract, current availability, and payment instructions before sending money.`,
    matches: ranked,
  };
}
