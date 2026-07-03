export interface Dorm {
  id: string;
  name: string;
  address: string;
  price: number;
  images: string[];
  amenities: string[];
  utilities: string[];
  genderPolicy: string;
  curfew: string;
  available: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}