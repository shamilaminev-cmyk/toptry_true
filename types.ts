
export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  UNISEX = 'UNISEX'
}

export enum Category {
  TOPS = 'Верх',
  BOTTOMS = 'Низ',
  DRESSES = 'Платья',
  SHOES = 'Обувь',
  ACCESSORIES = 'Аксессуары',
  OUTERWEAR = 'Верхняя одежда'
}

export enum SubscriptionTier {
  FREE = 'FREE',
  SILVER = 'SILVER',
  GOLD = 'GOLD'
}

export interface Store {
  id: string;
  name: string;
  logoUrl?: string;
  affiliatePattern: string;
}

export interface Product {
  id: string;
  title: string;
  price: number;
  oldPrice?: number;
  discountPercent?: number;
  currency: string;
  gender: Gender;
  category: Category;
  displayCategory?: string;
  sizes: string[];
  images: string[];
  storeId: string;
  storeName?: string;
  brand?: string;
  productUrl?: string;
  affiliateUrl?: string;
  availability: boolean;
  isCatalog: boolean;
}

export interface WardrobeItem extends Product {
  userId: string;
  addedAt: Date;
  customImage?: string;

  /**
   * Extended fields for the "digital twin" of user's real wardrobe.
   * These are optional to keep backward compatibility with older saved state.
   */
  sourceType?: 'catalog' | 'own';
  originalImage?: string; // original uploaded photo (data URL or URL)
  cutoutImage?: string;   // background-removed cutout (data URL or URL)
  tags?: string[];
  color?: string;
  material?: string;
  notes?: string;
}

export interface User {
  id: string;
  email?: string;
  name: string;
  username: string;
  phone: string;
  avatarUrl?: string;
  selfieUrl?: string;
  tier: SubscriptionTier;
  limits: {
    hdTryOnRemaining: number;
    looksRemaining: number;
  };
  isPublic: boolean;
}

export interface Look {
  id: string;
  userId: string;
  title: string;
  items: string[]; // Product IDs
  resultImageUrl?: string;
  isPublic: boolean;
  likes: number;
  comments: number;
  wantTryCount?: number;
  wouldBuyCount?: number;
  saves?: number;
  createdAt: Date;
  authorName?: string;
  authorAvatar?: string;

  userDescription?: string;
  aiDescription?: string;
  priceBuyNowRUB?: number;
  buyLinks?: string[];

  viewerReaction?: 'like' | 'want_try' | 'would_buy' | null;
  viewerSaved?: boolean;
}

export interface Comment {
  id: string;
  lookId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: Date;
  authorAvatar?: string;
}

export enum HomeLayout {
  DASHBOARD = 'dashboard',
  FEED = 'feed'
}
