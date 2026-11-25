export type PusdSchoolId = 'amador-valley' | 'foothill';

export interface SchoolOption {
  id: PusdSchoolId;
  name: string;
  shortName: string;
  district: string;
  host: string;
}

export const PUSD_HOST = 'ca-pleas-psv.edupoint.com';

export const PUSD_SCHOOLS: SchoolOption[] = [
  {
    id: 'amador-valley',
    name: 'Amador Valley High School',
    shortName: 'Amador Valley HS',
    district: 'Pleasanton Unified School District',
    host: PUSD_HOST,
  },
  {
    id: 'foothill',
    name: 'Foothill High School',
    shortName: 'Foothill HS',
    district: 'Pleasanton Unified School District',
    host: PUSD_HOST,
  },
];

export function getSchoolOption(id: PusdSchoolId): SchoolOption {
  return PUSD_SCHOOLS.find((s) => s.id === id) || PUSD_SCHOOLS[0];
}

export function detectSchoolIdFromName(schoolName?: string | null): PusdSchoolId | null {
  if (!schoolName) return null;
  const lower = schoolName.toLowerCase();
  if (lower.includes('foothill')) return 'foothill';
  if (lower.includes('amador')) return 'amador-valley';
  return null;
}
