export interface Trial {
  id: string;
  name: string;
  phase: string;
  status: 'active' | 'recruiting' | 'completed' | 'on-hold';
  sponsor: string;
  enrolled: number;
  target: number;
  color: string; // For trial badge
}

export const mockTrials: Trial[] = [
  {
    id: 'abc-123',
    name: 'Phase III Diabetes Study',
    phase: 'Phase III',
    status: 'active',
    sponsor: 'Novo Nordisk',
    enrolled: 12,
    target: 50,
    color: '#3b82f6', // blue
  },
  {
    id: 'def-456',
    name: 'Oncology Trial',
    phase: 'Phase II',
    status: 'recruiting',
    sponsor: 'Roche',
    enrolled: 8,
    target: 30,
    color: '#8b5cf6', // purple
  },
  {
    id: 'ghi-789',
    name: 'Cardiovascular Study',
    phase: 'Phase III',
    status: 'active',
    sponsor: 'Pfizer',
    enrolled: 25,
    target: 100,
    color: '#10b981', // green
  },
  {
    id: 'jkl-012',
    name: 'Neurology Research',
    phase: 'Phase I',
    status: 'recruiting',
    sponsor: 'Biogen',
    enrolled: 3,
    target: 15,
    color: '#f59e0b', // amber
  },
  {
    id: 'mno-345',
    name: 'Respiratory Trial',
    phase: 'Phase II',
    status: 'active',
    sponsor: 'AstraZeneca',
    enrolled: 18,
    target: 60,
    color: '#ef4444', // red
  },
  {
    id: 'pqr-678',
    name: 'Immunology Study',
    phase: 'Phase III',
    status: 'active',
    sponsor: 'Johnson & Johnson',
    enrolled: 45,
    target: 120,
    color: '#06b6d4', // cyan
  },
  {
    id: 'stu-901',
    name: 'Dermatology Research',
    phase: 'Phase II',
    status: 'recruiting',
    sponsor: 'Galderma',
    enrolled: 6,
    target: 25,
    color: '#ec4899', // pink
  },
  {
    id: 'vwx-234',
    name: 'Gastroenterology Trial',
    phase: 'Phase III',
    status: 'on-hold',
    sponsor: 'Takeda',
    enrolled: 32,
    target: 80,
    color: '#6366f1', // indigo
  },
];
