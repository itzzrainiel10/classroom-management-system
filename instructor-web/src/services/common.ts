/** Shared shapes from the database (same tables the admin website and the mobile app use). */
export type Subject = { id: string; code: string; name: string; department: string; units: number; description: string };
export type Section = { id: string; name: string; program: string; year_level: number; department: string };
export type Settings = { current_semester: string; current_academic_year: string; semester_start: string | null; semester_end: string | null };
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
