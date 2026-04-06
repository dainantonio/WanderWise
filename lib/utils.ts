import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cleanFirestoreData(data: any): any {
  if (data === null || typeof data !== 'object') return data;
  
  // Check if it's a plain object
  const isPlainObject = (obj: any) => Object.prototype.toString.call(obj) === '[object Object]';
  
  if (Array.isArray(data)) return data.map(cleanFirestoreData);
  if (!isPlainObject(data)) return data;
  
  const cleaned: any = {};
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined) {
      cleaned[key] = cleanFirestoreData(data[key]);
    }
  });
  return cleaned;
}
