'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { Map, Marker } from 'pigeon-maps';
import { 
  MapPin, 
  Compass, 
  Users, 
  Heart, 
  DollarSign, 
  Sun, 
  Clock, 
  ChevronRight, 
  Loader2, 
  History, 
  LogOut, 
  LogIn,
  Sparkles,
  Navigation,
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  Calendar,
  Star,
  Globe,
  MessageSquare,
  Map as MapIcon,
  List,
  Share2,
  Mic,
  MicOff,
  Edit3,
  Download,
  Save,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  StickyNote,
  Plus,
  Coffee,
  Landmark,
  UtensilsCrossed
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';
import { DayPicker, DateRange } from 'react-day-picker';
import { format, addDays } from 'date-fns';
import 'react-day-picker/dist/style.css';
import { useAuth } from '@/components/AuthProvider';
import { cleanFirestoreData } from '@/lib/utils';
import { db } from '@/firebase';
import { 
  collection, 
  addDoc, 
  setDoc, 
  doc, 
  getDoc, 
  deleteDoc,
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! });

interface SearchPlan {
  search_query: string;
  location: string;
  radius: string;
  filters: string[];
  sort_by: string;
}

interface Preferences {
  groupType: string;
  interests: string[];
  budget: string;
  indoorOutdoor: string;
  duration: string;
  urgency?: string;
  vibe?: string;
  travelStyle?: string;
  searchPlan?: SearchPlan;
  startDate?: string;
  endDate?: string;
  learnedPreferences?: string;
}

interface Location {
  latitude: number;
  longitude: number;
}

interface RecommendationItem {
  title: string;
  subtitle: string;
  reason: string;
  rating: string;
  distance: string;
  address: string;
  hours: string;
  latitude: number;
  longitude: number;
  website?: string;
  reviews?: { author: string; text: string; rating: number }[];
  imageUrl?: string;
  imageUrls?: string[];
  price_level?: string;
  attributes?: string[];
  rank?: number;
  confidence?: number;
  // Legacy fields for compatibility with history
  name?: string;
  type?: string;
  why?: string;
  cost?: string;
  funTip?: string;
}

type Screen = 'home' | 'input' | 'loading' | 'results' | 'detail' | 'action' | 'itinerary';

interface ItineraryStop {
  id: string;
  title: string;
  notes: string;
  location?: { latitude: number; longitude: number };
}

interface ItineraryDay {
  dayNumber: number;
  stops: ItineraryStop[];
}

interface Itinerary {
  id?: string;
  title: string;
  days: ItineraryDay[];
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export default function TravelAssistant() {
  const { user, loading: authLoading, signIn, logout } = useAuth();
  
  const handleFirestoreError = useCallback((error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: user?.uid,
        email: user?.email,
        emailVerified: user?.emailVerified,
        isAnonymous: user?.isAnonymous,
        tenantId: user?.tenantId,
        providerInfo: user?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }, [user]);
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [preferences, setPreferences] = useState<Preferences>({
    groupType: 'solo',
    interests: [],
    budget: 'mid-range',
    indoorOutdoor: 'both',
    duration: 'a few hours',
    travelStyle: 'balanced'
  });
  const [location, setLocation] = useState<Location | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationItem[] | string | null>(null);
  const [selectedItem, setSelectedItem] = useState<RecommendationItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [showPreferences, setShowPreferences] = useState(true);
  const [userInput, setUserInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [currentRecId, setCurrentRecId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: addDays(new Date(), 3),
  });
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [itinerary, setItinerary] = useState<Itinerary>({
    title: 'My Adventure',
    days: [{ dayNumber: 1, stops: [] }]
  });
  const [savedItineraries, setSavedItineraries] = useState<Itinerary[]>([]);
  const [isSavingItinerary, setIsSavingItinerary] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [addingToItineraryIdx, setAddingToItineraryIdx] = useState<number | null>(null);

  const loadItinerary = (it: Itinerary) => {
    setItinerary(it);
    setCurrentScreen('itinerary');
  };

  const deleteItinerary = async (id: string) => {
    if (!user || !id) return;
    try {
      const itRef = doc(db, `users/${user.uid}/itineraries/${id}`);
      await deleteDoc(itRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/itineraries/${id}`);
    }
  };

  const addToItinerary = (item: RecommendationItem, dayNumber: number = 1) => {
    setItinerary(prev => {
      const newDays = [...prev.days];
      const dayIndex = newDays.findIndex(d => d.dayNumber === dayNumber);
      
      const newStop: ItineraryStop = {
        id: Math.random().toString(36).substr(2, 9),
        title: item.title || item.name || 'Unknown Place',
        notes: '',
        location: item.latitude && item.longitude ? { latitude: item.latitude, longitude: item.longitude } : undefined
      };

      if (dayIndex >= 0) {
        newDays[dayIndex].stops.push(newStop);
      } else {
        newDays.push({ dayNumber, stops: [newStop] });
      }

      return { ...prev, days: newDays };
    });
  };

  const saveItinerary = async () => {
    if (!user) return;
    setIsSavingItinerary(true);
    try {
      if (itinerary.id) {
        const itRef = doc(db, `users/${user.uid}/itineraries/${itinerary.id}`);
        await setDoc(itRef, cleanFirestoreData({
          ...itinerary,
          uid: user.uid,
          updatedAt: serverTimestamp()
        }), { merge: true });
      } else {
        const itineraryRef = collection(db, `users/${user.uid}/itineraries`);
        const docRef = await addDoc(itineraryRef, cleanFirestoreData({
          ...itinerary,
          uid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }));
        setItinerary(prev => ({ ...prev, id: docRef.id }));
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, itinerary.id ? OperationType.WRITE : OperationType.CREATE, `users/${user.uid}/itineraries`);
    } finally {
      setIsSavingItinerary(false);
    }
  };

  const exportItinerary = () => {
    const text = itinerary.days.map(day => {
      const stops = day.stops.map(stop => `- ${stop.title}${stop.notes ? ` (${stop.notes})` : ''}`).join('\n');
      return `Day ${day.dayNumber}:\n${stops}`;
    }).join('\n\n');

    const blob = new Blob([`Itinerary: ${itinerary.title}\n\n${text}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${itinerary.title.replace(/\s+/g, '_')}_itinerary.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleSelectItem = async (item: RecommendationItem) => {
    setSelectedItem(item);
    if (!user || !currentRecId) return;
    
    // Selecting an item is a form of positive feedback
    try {
      const learningPrompt = `
        User selected/clicked on: "${item.title || item.name}"
        Description: "${item.reason || item.why}"
        Current learned preferences: "${preferences.learnedPreferences || 'None'}"
        
        Task: Update the user's learned preferences based on this selection. 
        Keep it concise (1-2 sentences). 
        Focus on what this choice tells us about their current interests or travel style.
        Output ONLY the updated learned preferences string.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: learningPrompt,
      });

      const newLearnedPrefs = response.text?.trim() || preferences.learnedPreferences;
      
      const prefRef = doc(db, `users/${user.uid}/preferences/current`);
      await setDoc(prefRef, cleanFirestoreData({ 
        learnedPreferences: newLearnedPrefs,
        uid: user.uid,
        updatedAt: serverTimestamp()
      }), { merge: true });

      setPreferences(prev => ({ ...prev, learnedPreferences: newLearnedPrefs }));

      // Also mark as 'like' in the database
      const recRef = doc(db, `users/${user.uid}/recommendations/${currentRecId}`);
      await setDoc(recRef, { feedback: 'like' }, { merge: true });
    } catch (error) {
      console.error("Selection learning error:", error);
    }
  };
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = false;
        recognitionInstance.interimResults = false;
        recognitionInstance.lang = 'en-US';

        recognitionInstance.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setUserInput(prev => prev + (prev ? ' ' : '') + transcript);
          setIsRecording(false);
        };

        recognitionInstance.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
        };

        recognitionInstance.onend = () => {
          setIsRecording(false);
        };

        setRecognition(recognitionInstance);
      }
    }
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      recognition?.stop();
    } else {
      try {
        recognition?.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Error starting recognition:', err);
      }
    }
  };

  const handleFeedback = async (recId: string, itemTitle: string, feedback: 'like' | 'dislike') => {
    if (!user) return;
    setIsLearning(true);
    try {
      const recRef = doc(db, `users/${user.uid}/recommendations/${recId}`);
      await setDoc(recRef, { feedback }, { merge: true });

      // AI Learning Step
      const learningPrompt = `
        User feedback on recommendation: "${itemTitle}"
        User liked/disliked: ${feedback}
        Current learned preferences: "${preferences.learnedPreferences || 'None'}"
        
        Task: Update the user's learned preferences based on this feedback. 
        Keep it concise (1-2 sentences). 
        Focus on what this tells us about their travel style, budget sensitivity, or activity preferences.
        Output ONLY the updated learned preferences string.
      `;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: learningPrompt,
        });

        const newLearnedPrefs = response.text?.trim() || preferences.learnedPreferences;
        
        // Update preferences in Firestore
        const prefRef = doc(db, `users/${user.uid}/preferences/current`);
        await setDoc(prefRef, cleanFirestoreData({ 
          learnedPreferences: newLearnedPrefs,
          uid: user.uid,
          updatedAt: serverTimestamp()
        }), { merge: true });

        setPreferences(prev => ({ ...prev, learnedPreferences: newLearnedPrefs }));
    } catch (error) {
      if (error instanceof Error && error.message.includes('Firestore Error')) throw error;
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/preferences/current`);
    } finally {
      setIsLearning(false);
    }
  };

  const handleShare = async (item: RecommendationItem) => {
    const shareData = {
      title: item.title || item.name || 'Check out this place!',
      text: `I found this amazing place on WanderWise AI: ${item.title || item.name}. ${item.reason || item.why}`,
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback: Copy to clipboard
        const shareText = `${shareData.title}\n${shareData.text}\n${shareData.url}`;
        await navigator.clipboard.writeText(shareText);
        setShowCopied(true);
        setTimeout(() => setShowCopied(false), 2000);
      }
    } catch (err) {
      console.error('Error sharing:', err);
    }
  };

  const parseInput = async () => {
    if (!userInput.trim() || !user) return;
    setIsParsing(true);
    setCurrentScreen('loading');
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are an intelligent intent parser for real-world decisions.

User query:
"${userInput}"

Extract and return structured intent in JSON format:

{
  "category": "", 
  "intent": "",
  "constraints": [],
  "urgency": "",
  "vibe": "",
  "group_type": "",
  "price_level": ""
}

Rules:
- Infer meaning, don’t just copy words
- Constraints include things like: cheap, fast, nearby, open now
- Vibe includes: cozy, fun, quiet, upscale, kid-friendly
- Group type: solo, couple, family, group
- Urgency: low, medium, high

Return ONLY valid JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              intent: { type: Type.STRING },
              constraints: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              urgency: { type: Type.STRING },
              vibe: { type: Type.STRING },
              group_type: { type: Type.STRING },
              price_level: { type: Type.STRING }
            }
          }
        }
      });

      let result: any = {};
      try {
        result = JSON.parse(response.text || '{}');
      } catch (e) {
        console.error("Step 1 parse error:", e);
        // Attempt to extract JSON if it's wrapped in text
        const jsonMatch = response.text?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            result = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            console.error("Step 1 emergency parse error:", e2);
          }
        }
      }
      
      // Step 2: Search Planning Agent
      const planningResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are a search planning agent.

User intent:
${JSON.stringify(result, null, 2)}

Convert this into a structured search plan.

Return:

{
  "search_query": "",
  "location": "user_location",
  "radius": "",
  "filters": [],
  "sort_by": ""
}

Rules:
- Optimize for the user’s intent
- If urgency is high → prioritize distance and availability
- If vibe is present → include it in search query
- Keep search_query natural (like Google search)

Return ONLY JSON.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              search_query: { type: Type.STRING },
              location: { type: Type.STRING },
              radius: { type: Type.STRING },
              filters: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              sort_by: { type: Type.STRING }
            }
          }
        }
      });

      let searchPlan: any = {};
      try {
        searchPlan = JSON.parse(planningResponse.text || '{}');
      } catch (e) {
        console.error("Step 2 parse error:", e);
        const jsonMatch = planningResponse.text?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            searchPlan = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            console.error("Step 2 emergency parse error:", e2);
          }
        }
      }

      const mapBudget = (b: string) => {
        const lower = b.toLowerCase();
        if (lower === 'cheap' || lower === 'budget') return 'budget';
        if (lower === 'medium' || lower === 'mid-range') return 'mid-range';
        if (lower === 'upscale' || lower === 'luxury') return 'luxury';
        return preferences.budget;
      };

      // Map result to preferences
      const updatedPrefs: Preferences = {
        ...preferences,
        groupType: result.group_type?.toLowerCase() || preferences.groupType,
        budget: result.price_level ? mapBudget(result.price_level) : preferences.budget,
        urgency: result.urgency || preferences.urgency,
        vibe: result.vibe || preferences.vibe,
        // We can infer duration from constraints if it contains time words
        duration: result.constraints?.find((c: string) => 
          c.toLowerCase().includes('hour') || 
          c.toLowerCase().includes('day') || 
          c.toLowerCase().includes('fast') ||
          c.toLowerCase().includes('quick')
        ) || preferences.duration,
        // We can infer indoor/outdoor from constraints or vibe
        indoorOutdoor: result.constraints?.some((c: string) => c.toLowerCase().includes('outdoor')) ? 'outdoor' : 
                       result.constraints?.some((c: string) => c.toLowerCase().includes('indoor')) ? 'indoor' : preferences.indoorOutdoor,
        interests: [
          ...preferences.interests,
          ...(result.category ? [result.category] : []),
          ...(result.intent ? [result.intent] : []),
          ...(result.vibe ? [result.vibe] : [])
        ].filter((item, index, self) => self.indexOf(item) === index), // Unique
        searchPlan: searchPlan,
        startDate: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined,
        endDate: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
      };

      setPreferences(updatedPrefs);

      // Persist immediately
      const prefRef = doc(db, `users/${user.uid}/preferences/current`);
      await setDoc(prefRef, cleanFirestoreData({ 
        ...updatedPrefs,
        uid: user.uid,
        updatedAt: serverTimestamp()
      }), { merge: true });

      setUserInput('');
      generateRecommendation();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Firestore Error')) throw error;
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/preferences/current`);
    } finally {
      setIsParsing(false);
    }
  };

  // Fetch history and preferences
  useEffect(() => {
    if (!user) return;

    // Fetch history
    const q = query(
      collection(db, `users/${user.uid}/recommendations`),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const unsubscribeHistory = onSnapshot(q, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/recommendations`);
    });

    // Fetch preferences
    const prefRef = doc(db, `users/${user.uid}/preferences/current`);
    getDoc(prefRef).then(docSnap => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPreferences(prev => ({ ...prev, ...data }));
        if (data.startDate && data.endDate) {
          setDateRange({
            from: new Date(data.startDate),
            to: new Date(data.endDate)
          });
        }
      }
    }).catch(error => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/preferences/current`);
    });

    // Fetch itineraries
    const itQuery = query(
      collection(db, `users/${user.uid}/itineraries`),
      orderBy('createdAt', 'desc')
    );
    const unsubscribeItineraries = onSnapshot(itQuery, (snapshot) => {
      setSavedItineraries(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Itinerary)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/itineraries`);
    });

    return () => {
      unsubscribeHistory();
      unsubscribeItineraries();
    };
  }, [user, handleFirestoreError]);

  // Get location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => console.error("Geolocation error:", error)
      );
    }
  }, []);

  const handleInterestToggle = (interest: string) => {
    setPreferences(prev => ({
      ...prev,
      interests: prev.interests.includes(interest) 
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  const handleTravelStyleSelect = (style: string) => {
    setPreferences(prev => ({
      ...prev,
      travelStyle: style
    }));
  };

  const generateRecommendation = async () => {
    if (!user) return;
    setLoading(true);
    setRecommendation(null);
    setCurrentScreen('loading');

    try {
      // Step 1: Search Agent
      const searchPrompt = `
        You are a search agent. Use Google Maps to find the best 5-8 places for the user's intent.
        
        User query: "${userInput || 'general discovery'}"
        
        Context: 
        - Location: ${location ? `${location.latitude},${location.longitude}` : 'Unknown'}
        - Travel Preferences: ${preferences.groupType}, ${preferences.interests.join(', ')}, ${preferences.budget}, ${preferences.indoorOutdoor}, ${preferences.duration}, Style: ${preferences.travelStyle || 'balanced'}
        - Search Plan: ${preferences.searchPlan ? JSON.stringify(preferences.searchPlan) : 'None'}
        
        Return a list of places with their raw details (name, address, rating, price level, types, etc.).
      `;

      const searchResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: searchPrompt,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: location ? {
                latitude: location.latitude,
                longitude: location.longitude
              } : undefined
            }
          }
        }
      });

      const rawPlacesData = searchResponse.text;

      // Step 2: Data Enrichment Agent
      const enrichmentPrompt = `
        You are a data enrichment agent.

        User intent:
        ${JSON.stringify(preferences.searchPlan || preferences)}

        Raw places data:
        ${rawPlacesData}

        For each place:
        - Clean the name
        - Summarize what it is
        - Extract useful attributes
        - Include all necessary metadata (latitude, longitude, address, hours, website, reviews, imageUrls, reason)

        Return:

        [
          {
            "title": "Clean Name",
            "subtitle": "Summary",
            "rating": "4.5",
            "distance": "0.5 miles",
            "price_level": "$$",
            "attributes": ["Cozy", "Quiet"],
            "reason": "Why it fits the user intent",
            "address": "Full address",
            "hours": "Hours",
            "latitude": 0,
            "longitude": 0,
            "website": "URL",
            "reviews": [],
            "imageUrl": "Main Image URL",
            "imageUrls": ["URL1", "URL2"]
          }
        ]

        Keep it clean and structured.
        Return ONLY JSON.
      `;

      const enrichmentResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: enrichmentPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                rating: { type: Type.STRING },
                distance: { type: Type.STRING },
                price_level: { type: Type.STRING },
                attributes: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                reason: { type: Type.STRING },
                address: { type: Type.STRING },
                hours: { type: Type.STRING },
                latitude: { type: Type.NUMBER },
                longitude: { type: Type.NUMBER },
                website: { type: Type.STRING },
                reviews: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      author: { type: Type.STRING },
                      text: { type: Type.STRING },
                      rating: { type: Type.NUMBER }
                    }
                  }
                },
                imageUrl: { type: Type.STRING },
                imageUrls: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              }
            }
          }
        }
      });

      // Step 3: Decision-making Agent
      const decisionPrompt = `
        You are a decision-making agent.

        User intent:
        ${JSON.stringify(preferences.searchPlan || preferences)}

        Available options:
        ${enrichmentResponse.text}

        Your job:
        - Select the BEST 3 options
        - Rank them #1, #2, #3

        Consider:
        - Intent match (most important)
        - Distance
        - Rating
        - Price fit
        - Unique value

        Return:

        [
          {
            "rank": 1,
            "title": "MUST MATCH EXACT TITLE FROM ENRICHMENT DATA",
            "subtitle": "",
            "rating": "",
            "distance": "",
            "reason": "Specific reason for this rank",
            "confidence": 95
          }
        ]

        Rules:
        - Be decisive
        - Only return 3 results
        - Confidence = 0–100

        Return ONLY JSON.
      `;

      const decisionResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: decisionPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                rank: { type: Type.NUMBER },
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                rating: { type: Type.STRING },
                distance: { type: Type.STRING },
                reason: { type: Type.STRING },
                confidence: { type: Type.NUMBER }
              }
            }
          }
        }
      });

      let enrichmentText = enrichmentResponse.text || "[]";
      let decisionText = decisionResponse.text || "[]";
      
      try {
        const enrichedItems: RecommendationItem[] = JSON.parse(enrichmentText);
        const decisions: any[] = JSON.parse(decisionText);
        
        // Merge decisions with enriched items
        const items: RecommendationItem[] = decisions.map(decision => {
          const matchedItem = enrichedItems.find(item => 
            item.title.toLowerCase() === decision.title.toLowerCase() ||
            decision.title.toLowerCase().includes(item.title.toLowerCase()) ||
            item.title.toLowerCase().includes(decision.title.toLowerCase())
          );
          
          if (matchedItem) {
            return {
              ...matchedItem,
              rank: decision.rank,
              confidence: decision.confidence,
              reason: decision.reason || matchedItem.reason // Use decision's reason if available
            };
          }
          
          // Fallback if no match found (should be rare with good prompting)
          return {
            ...decision,
            address: '',
            hours: '',
            latitude: 0,
            longitude: 0
          } as RecommendationItem;
        }).sort((a, b) => (a.rank || 99) - (b.rank || 99));

        setRecommendation(items);

        // Save to Firestore
        const docRef = await addDoc(collection(db, `users/${user.uid}/recommendations`), {
          uid: user.uid,
          content: JSON.stringify(items), // Store as JSON string in history
          location: location,
          createdAt: serverTimestamp(),
          preferences: preferences
        });
        setCurrentRecId(docRef.id);

        // Auto-navigate to results after 3 seconds
        setTimeout(() => {
          setCurrentScreen('results');
          setLoading(false);
        }, 3000);
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        setRecommendation(enrichmentText); // Fallback to raw text if parsing fails
        setTimeout(() => {
          setCurrentScreen('results');
          setLoading(false);
        }, 2000);
      }

      // Save preferences
      await setDoc(doc(db, `users/${user.uid}/preferences/current`), cleanFirestoreData({
        ...preferences,
        uid: user.uid,
        updatedAt: serverTimestamp()
      }));

    } catch (error) {
      console.error("Generation error:", error);
      setRecommendation("Something went wrong. Please try again later.");
      setLoading(false);
      setCurrentScreen('home');
    }
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'home':
        return (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-16"
          >
            <section className="text-center py-16 space-y-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 text-indigo-600 text-xs font-black uppercase tracking-[0.2em] mb-4">
                <Sparkles className="w-4 h-4" /> AI-Powered Discovery
              </div>
              <h2 className="text-7xl font-display font-black tracking-tight text-slate-900 leading-[1.1]">
                Where to next,<br />
                <span className="text-indigo-600">{user?.displayName?.split(' ')[0]}?</span>
              </h2>
              <p className="text-slate-500 text-2xl font-medium max-w-2xl mx-auto leading-relaxed">
                Your agentic travel companion for instant local discovery and personalized journeys.
              </p>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: 'Food', icon: Compass, color: 'bg-orange-50 text-orange-600 border-orange-100 hover:bg-orange-100' },
                { label: 'Activities', icon: Navigation, color: 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100' },
                { label: 'Plan a Trip', icon: Calendar, color: 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100' },
                { label: 'Surprise Me', icon: Sparkles, color: 'bg-purple-50 text-purple-600 border-purple-100 hover:bg-purple-100' }
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    if (item.label === 'Plan a Trip') {
                      setShowCalendar(true);
                    }
                    setUserInput(item.label === 'Plan a Trip' ? '' : item.label);
                    setCurrentScreen('input');
                  }}
                  className={`flex flex-col items-center justify-center gap-6 p-10 rounded-[40px] border transition-all hover:shadow-2xl hover:-translate-y-2 ${item.color}`}
                >
                  <div className="w-16 h-16 rounded-3xl bg-white flex items-center justify-center shadow-sm">
                    <item.icon className="w-8 h-8" />
                  </div>
                  <span className="font-display font-black text-lg uppercase tracking-widest">{item.label}</span>
                </button>
              ))}
            </div>

            <section className="bg-white p-10 rounded-[48px] border border-slate-100 shadow-2xl shadow-slate-100">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 relative">
                  <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-indigo-400" />
                  <input 
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && parseInput()}
                    placeholder="Type what you want to do right now..."
                    className="w-full bg-slate-50 border-none rounded-3xl pl-16 pr-16 py-6 text-slate-700 text-xl font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  />
                  {recognition && (
                    <button
                      onClick={toggleRecording}
                      className={`absolute right-6 top-1/2 -translate-y-1/2 p-3 rounded-2xl transition-all ${
                        isRecording 
                          ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-200' 
                          : 'bg-white text-indigo-400 hover:text-indigo-600 hover:bg-slate-50 shadow-sm'
                      }`}
                      title={isRecording ? 'Stop Recording' : 'Start Voice Input'}
                    >
                      {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                  )}
                </div>
                <button 
                  onClick={parseInput}
                  disabled={isParsing || !userInput.trim()}
                  className="bg-indigo-600 text-white px-12 py-6 rounded-3xl font-display font-black text-xl hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-200 disabled:opacity-50 active:scale-95"
                >
                  {isParsing ? <Loader2 className="w-8 h-8 animate-spin" /> : 'Find Best Options'}
                </button>
              </div>
              {dateRange?.from && (
                <div className="mt-4 flex items-center gap-2 text-slate-400 font-medium text-sm">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <span>
                    Travel Dates: {dateRange.to ? (
                      `${format(dateRange.from, "MMM dd")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                    ) : (
                      format(dateRange.from, "MMM dd, yyyy")
                    )}
                  </span>
                  <button 
                    onClick={() => {
                      setShowCalendar(true);
                      setCurrentScreen('input');
                    }}
                    className="ml-2 text-xs text-blue-600 hover:underline"
                  >
                    Change
                  </button>
                  <span className="text-slate-200">|</span>
                  <button 
                    onClick={() => {
                      setDateRange(undefined);
                      setPreferences(prev => ({ ...prev, startDate: undefined, endDate: undefined }));
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </section>

            {history.length > 0 && (
              <section className="pt-10 overflow-hidden">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-400 uppercase tracking-widest text-sm px-2">
                  <History className="w-5 h-5" /> Recent Journeys
                </h3>
                <div className="relative">
                  <div className="flex gap-[12px] overflow-x-auto pb-6 px-2 snap-x snap-mandatory no-scrollbar">
                    {history.map((item) => {
                      let title = "Travel Discovery";
                      let subtitle = "Personalized recommendations";
                      try {
                        const parsed = JSON.parse(item.content);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                          title = parsed[0].title || parsed[0].name || "Travel Discovery";
                          subtitle = parsed[0].reason || parsed[0].why || "Personalized recommendations";
                        }
                      } catch (e) {
                        title = "Past Search";
                        subtitle = item.content.substring(0, 60) + "...";
                      }
                      const date = item.createdAt?.toDate ? new Date(item.createdAt.toDate()).toLocaleDateString() : 'Recently';

                      return (
                        <div 
                          key={item.id} 
                          className="flex-none w-[300px] snap-center p-6 bg-white border border-slate-100 rounded-[32px] shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-h-[180px]"
                        >
                          <div className="space-y-2">
                            <h4 className="font-bold text-slate-900 text-lg line-clamp-1">{title}</h4>
                            <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">{subtitle}</p>
                          </div>
                          
                          <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                              {date}
                            </div>
                            <button 
                              onClick={() => {
                                try {
                                  const parsed = JSON.parse(item.content);
                                  setRecommendation(parsed);
                                  if (Array.isArray(parsed) && parsed.length > 0) {
                                    setSelectedItem(parsed[0]);
                                    setCurrentScreen('detail');
                                  } else {
                                    setCurrentScreen('results');
                                  }
                                } catch (e) {
                                  setRecommendation(item.content);
                                  setCurrentScreen('results');
                                }
                              }}
                              className="text-blue-600 font-bold text-xs uppercase tracking-widest hover:text-blue-700 transition-colors"
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Fade edges */}
                  <div className="absolute top-0 left-0 bottom-6 w-8 bg-gradient-to-r from-slate-50 to-transparent pointer-events-none"></div>
                  <div className="absolute top-0 right-0 bottom-6 w-8 bg-gradient-to-l from-slate-50 to-transparent pointer-events-none"></div>
                </div>
              </section>
            )}

            {savedItineraries.length > 0 && (
              <section className="pt-10 overflow-hidden">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-400 uppercase tracking-widest text-sm px-2">
                  <Calendar className="w-5 h-5" /> Saved Itineraries
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-8 px-2 no-scrollbar">
                  <button
                    onClick={() => {
                      setItinerary({
                        title: 'New Adventure',
                        days: [{ dayNumber: 1, stops: [] }]
                      });
                      setCurrentScreen('itinerary');
                    }}
                    className="flex-none w-72 p-6 rounded-[32px] border-2 border-dashed border-slate-100 flex flex-col items-center justify-center gap-4 text-slate-400 hover:border-indigo-200 hover:text-indigo-600 hover:bg-indigo-50/30 transition-all group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      <Plus className="w-6 h-6" />
                    </div>
                    <span className="font-display font-black uppercase tracking-widest text-xs">New Plan</span>
                  </button>
                  {savedItineraries.map((it) => (
                    <div
                      key={it.id}
                      className="flex-none w-72 p-6 rounded-[32px] bg-white border border-slate-100 hover:border-indigo-200 hover:shadow-xl transition-all group relative"
                    >
                      <button
                        onClick={() => loadItinerary(it)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">
                              {it.days.length} Days • {it.days.reduce((acc, d) => acc + d.stops.length, 0)} Stops
                            </p>
                            <p className="font-display font-black text-slate-900 truncate">
                              {it.title}
                            </p>
                          </div>
                        </div>
                        <div className="flex -space-x-2 overflow-hidden mb-4">
                          {it.days.flatMap(d => d.stops).slice(0, 4).map((stop, i) => (
                            <div key={i} className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400">
                              {stop.title.charAt(0)}
                            </div>
                          ))}
                          {it.days.flatMap(d => d.stops).length > 4 && (
                            <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-slate-50 flex items-center justify-center text-[8px] font-black text-slate-400">
                              +{it.days.flatMap(d => d.stops).length - 4}
                            </div>
                          )}
                        </div>
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (it.id) deleteItinerary(it.id);
                        }}
                        className="absolute top-4 right-4 p-2 rounded-xl text-slate-200 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </motion.div>
        );

      case 'input':
        return (
          <motion.div 
            key="input"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-12"
          >
            <button 
              onClick={() => setCurrentScreen('home')}
              className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-xs hover:text-indigo-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Home
            </button>

            <section className="space-y-10">
              <div className="space-y-4">
                <h2 className="text-5xl font-display font-black text-slate-900 tracking-tight leading-tight">What are you<br />looking for?</h2>
                <p className="text-slate-500 text-xl font-medium">Describe your ideal experience in a few words.</p>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Your Request</label>
                <div className="relative">
                  <textarea 
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="e.g., I want a quiet place to read for 2 hours with good tea..."
                    className="w-full bg-white border border-slate-100 rounded-[32px] px-8 py-8 pr-20 text-slate-700 text-xl font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all min-h-[180px] shadow-sm"
                  />
                  {recognition && (
                    <button
                      onClick={toggleRecording}
                      className={`absolute right-6 bottom-6 p-4 rounded-2xl transition-all ${
                        isRecording 
                          ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-200' 
                          : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 shadow-sm'
                      }`}
                      title={isRecording ? 'Stop Recording' : 'Start Voice Input'}
                    >
                      {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Travel Dates (Optional)</label>
                <div className="relative">
                  <button 
                    onClick={() => setShowCalendar(!showCalendar)}
                    className="w-full flex items-center justify-between bg-white border border-slate-100 rounded-[32px] px-8 py-6 text-slate-700 text-xl font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <span>
                        {dateRange?.from ? (
                          dateRange.to ? (
                            `${format(dateRange.from, "LLL dd")} - ${format(dateRange.to, "LLL dd, y")}`
                          ) : (
                            format(dateRange.from, "LLL dd, y")
                          )
                        ) : (
                          "Select your travel dates"
                        )}
                      </span>
                    </div>
                    <ChevronRight className={`w-6 h-6 text-slate-300 transition-transform ${showCalendar ? 'rotate-90' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {showCalendar && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 mt-4 bg-white border border-slate-100 rounded-[40px] p-6 shadow-2xl overflow-hidden left-0 right-0 md:left-auto md:right-0 md:w-[400px]"
                      >
                        <DayPicker
                          mode="range"
                          selected={dateRange}
                          onSelect={setDateRange}
                          className="border-none mx-auto"
                          classNames={{
                            months: "flex flex-col space-y-4",
                            month: "space-y-6",
                            caption: "flex justify-center pt-1 relative items-center mb-4",
                            caption_label: "text-lg font-display font-black text-slate-900",
                            nav: "space-x-1 flex items-center",
                            nav_button: "h-10 w-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-all",
                            nav_button_previous: "absolute left-1",
                            nav_button_next: "absolute right-1",
                            table: "w-full border-collapse space-y-1",
                            head_row: "flex mb-2",
                            head_cell: "text-slate-400 rounded-md w-12 font-black text-[0.7rem] uppercase tracking-widest",
                            row: "flex w-full mt-2",
                            cell: "h-12 w-12 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
                            day: "h-12 w-12 p-0 font-bold text-slate-600 aria-selected:opacity-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-2xl transition-all",
                            day_range_start: "day-range-start bg-indigo-600 text-white rounded-l-2xl",
                            day_range_end: "day-range-end bg-indigo-600 text-white rounded-r-2xl",
                            day_selected: "bg-indigo-600 text-white hover:bg-indigo-600 hover:text-white focus:bg-indigo-600 focus:text-white",
                            day_today: "bg-slate-100 text-slate-900",
                            day_outside: "text-slate-300 opacity-50",
                            day_disabled: "text-slate-300 opacity-50",
                            day_range_middle: "aria-selected:bg-indigo-50 aria-selected:text-indigo-600 rounded-none",
                            day_hidden: "invisible",
                          }}
                        />
                        <div className="mt-8 pt-6 border-t border-slate-50 flex justify-end">
                          <button 
                            onClick={() => setShowCalendar(false)}
                            className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-display font-black text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                          >
                            Confirm Dates
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Travel Style</label>
                <div className="flex flex-wrap gap-3">
                  {[
                    { id: 'adventurous', label: 'Adventurous', icon: Compass },
                    { id: 'relaxing', label: 'Relaxing', icon: Coffee },
                    { id: 'cultural', label: 'Cultural', icon: Landmark },
                    { id: 'foodie', label: 'Foodie', icon: UtensilsCrossed },
                    { id: 'balanced', label: 'Balanced', icon: Sparkles }
                  ].map(style => (
                    <button
                      key={style.id}
                      onClick={() => handleTravelStyleSelect(style.id)}
                      className={`flex items-center gap-2 px-6 py-3 rounded-2xl border transition-all ${
                        preferences.travelStyle === style.id
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-100'
                          : 'bg-white border-slate-100 text-slate-600 hover:border-indigo-200'
                      }`}
                    >
                      <style.icon className="w-4 h-4" />
                      <span className="font-bold text-sm">{style.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Quick Filters</label>
                <div className="flex flex-wrap gap-3">
                  {["Under 2 hours", "Budget-friendly", "Indoors", "Nearby"].map(chip => (
                    <button
                      key={chip}
                      onClick={() => setUserInput(prev => prev + (prev ? ', ' : '') + chip)}
                      className="px-6 py-3 rounded-2xl bg-white border border-slate-100 text-slate-600 font-bold text-sm hover:bg-indigo-600 hover:text-white hover:shadow-xl hover:shadow-indigo-100 transition-all"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <button 
              onClick={parseInput}
              disabled={isParsing || !userInput.trim()}
              className="w-full bg-indigo-600 text-white py-8 rounded-[32px] font-display font-black text-2xl hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-200 disabled:opacity-50 active:scale-[0.98]"
            >
              {isParsing ? <Loader2 className="w-8 h-8 animate-spin mx-auto" /> : 'Find Best Options'}
            </button>
          </motion.div>
        );

      case 'loading':
        return (
          <motion.div 
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12"
          >
            <div className="relative">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="w-32 h-32 border-4 border-indigo-50 border-t-indigo-600 rounded-[40px]"
              ></motion.div>
              <Sparkles className="w-10 h-10 text-indigo-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <div className="space-y-6">
              <h2 className="text-4xl font-display font-black text-slate-900 tracking-tight">Curating your journey...</h2>
              <div className="flex flex-col gap-3 text-slate-400 font-bold uppercase tracking-widest text-[10px]">
                {[
                  { text: "Understanding your intent", delay: 0.5 },
                  { text: "Checking local spots", delay: 1.5 },
                  { text: "Enriching location data", delay: 2.5 },
                  { text: "Ranking best options", delay: 3.5 }
                ].map((step, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ delay: step.delay }}
                    className="flex items-center justify-center gap-3"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-600"></div>
                    {step.text}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        );

      case 'results':
        return (
          <motion.div 
            key="results"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="space-y-12"
          >
            <div className="flex items-center justify-between">
              <button 
                onClick={() => setCurrentScreen('home')}
                className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-xs hover:text-indigo-600 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> New Search
              </button>
              <div className="flex items-center gap-4">
                <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200">
                  <button 
                    onClick={() => setViewMode('list')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'list' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <List className="w-3.5 h-3.5" /> List
                  </button>
                  <button 
                    onClick={() => setViewMode('map')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'map' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <MapIcon className="w-3.5 h-3.5" /> Map
                  </button>
                </div>
                <div className="hidden md:flex items-center gap-2 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                  <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                  {location ? `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}` : 'Location unknown'}
                </div>
                <button 
                  onClick={() => setCurrentScreen('itinerary')}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  <Calendar className="w-3.5 h-3.5" /> My Itinerary
                </button>
              </div>
            </div>

            <section className="space-y-10 overflow-hidden">
              <h2 className="text-5xl font-display font-black text-slate-900 px-2 tracking-tight">Top Recommendations</h2>
              
              {Array.isArray(recommendation) ? (
                <div className="relative">
                  {viewMode === 'list' ? (
                    <motion.div 
                      key="list-view"
                      className="flex gap-8 overflow-x-auto pb-16 px-2 snap-x snap-mandatory no-scrollbar"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      {recommendation.map((item, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, x: 50 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          onClick={() => {
                            setSelectedItem(item);
                            setCurrentScreen('detail');
                          }}
                          className="flex-none w-[85%] md:w-[440px] snap-center p-10 rounded-[48px] bg-white border border-slate-100 hover:border-indigo-200 hover:shadow-2xl hover:shadow-indigo-100 transition-all group relative cursor-pointer"
                        >
                          {item.rank && (
                            <div className={`absolute top-8 right-10 ${item.rank === 1 ? 'bg-indigo-600' : 'bg-slate-800'} text-white px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-indigo-200 flex items-center gap-2`}>
                              #{item.rank} {item.rank === 1 ? 'Top Pick' : ''} {item.confidence ? `• ${item.confidence}%` : ''}
                            </div>
                          )}
                          <div className="space-y-8 h-full flex flex-col">
                            <div className="space-y-4 flex-1">
                              <h3 className="font-display font-black text-3xl text-slate-900 group-hover:text-indigo-600 transition-colors leading-tight">{item.title || item.name}</h3>
                              <p className="text-slate-500 font-medium text-lg line-clamp-3 leading-relaxed">
                                {item.reason || item.why}
                              </p>
                            </div>
                            
                            <div className="space-y-4 pt-6 border-t border-slate-50">
                              <div className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                                <Navigation className="w-4 h-4 text-indigo-500" />
                                {item.distance} • {item.rating || item.cost} {item.price_level ? `• ${item.price_level}` : ''}
                              </div>
                              <div className="flex items-center gap-3 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                                <Compass className="w-4 h-4 text-indigo-500" />
                                {item.subtitle || item.type}
                              </div>
                              {item.attributes && item.attributes.length > 0 && (
                                <div className="flex flex-wrap gap-2 pt-2">
                                  {item.attributes.slice(0, 3).map(attr => (
                                    <span key={attr} className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[9px] font-black uppercase tracking-widest">
                                      {attr}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="pt-4 flex gap-2 relative">
                              <div className="flex-1 py-5 rounded-[24px] bg-slate-50 flex items-center justify-center gap-2 font-display font-black text-sm uppercase tracking-widest text-slate-600 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm group-hover:shadow-xl group-hover:shadow-indigo-100">
                                View Details <ChevronRight className="w-4 h-4" />
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddingToItineraryIdx(addingToItineraryIdx === idx ? null : idx);
                                }}
                                className={`p-5 rounded-[24px] transition-all shadow-sm hover:shadow-xl hover:shadow-indigo-100 ${addingToItineraryIdx === idx ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 hover:bg-indigo-600 hover:text-white'}`}
                              >
                                <Plus className="w-5 h-5" />
                              </button>

                              <AnimatePresence>
                                {addingToItineraryIdx === idx && (
                                  <motion.div 
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute bottom-full left-0 right-0 mb-4 bg-white/95 backdrop-blur-md p-6 rounded-[32px] shadow-2xl border border-indigo-100 z-20 space-y-4"
                                  >
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Add to Day</p>
                                    <div className="flex flex-wrap justify-center gap-2">
                                      {itinerary.days.map(day => (
                                        <button
                                          key={day.dayNumber}
                                          onClick={() => {
                                            addToItinerary(item, day.dayNumber);
                                            setAddingToItineraryIdx(null);
                                          }}
                                          className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-indigo-600 hover:text-white text-slate-600 font-black transition-all flex items-center justify-center"
                                        >
                                          {day.dayNumber}
                                        </button>
                                      ))}
                                      <button
                                        onClick={() => {
                                          const nextDay = itinerary.days.length + 1;
                                          setItinerary(prev => ({
                                            ...prev,
                                            days: [...prev.days, { dayNumber: nextDay, stops: [] }]
                                          }));
                                          addToItinerary(item, nextDay);
                                          setAddingToItineraryIdx(null);
                                        }}
                                        className="w-10 h-10 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 transition-all flex items-center justify-center"
                                      >
                                        <Plus className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="map-view"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-[600px] w-full rounded-[48px] overflow-hidden border border-slate-100 shadow-2xl shadow-slate-200 relative"
                    >
                      <Map 
                        defaultCenter={[location?.latitude || 37.7749, location?.longitude || -122.4194]} 
                        defaultZoom={13}
                      >
                        {recommendation.map((item, idx) => (
                          <Marker 
                            key={idx}
                            width={50}
                            anchor={[item.latitude, item.longitude]} 
                            onClick={() => {
                              setSelectedItem(item);
                              setCurrentScreen('detail');
                            }}
                          >
                            <div className="relative group">
                              <div className="bg-indigo-600 text-white p-3 rounded-full shadow-xl cursor-pointer hover:bg-indigo-700 hover:scale-110 transition-all border-2 border-white">
                                <MapPin className="w-6 h-6" />
                              </div>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-56 bg-white p-4 rounded-[24px] shadow-2xl border border-slate-100 opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 scale-95 group-hover:scale-100">
                                <p className="font-display font-black text-slate-900 text-sm leading-tight">{item.title}</p>
                                <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black mt-2">{item.subtitle}</p>
                                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-50">
                                  <div className="flex items-center gap-1 text-yellow-500">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    <span className="text-[10px] font-black">{item.rating}</span>
                                  </div>
                                  <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{item.distance}</span>
                                </div>
                              </div>
                            </div>
                          </Marker>
                        ))}
                      </Map>
                      <div className="absolute bottom-8 left-8 right-8 bg-white/80 backdrop-blur-xl p-5 rounded-[32px] border border-white/50 shadow-2xl flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">Tap pins to explore locations</p>
                        <div className="flex gap-2">
                          {recommendation.map((_, i) => (
                            <div key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-600/30"></div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  
                  {viewMode === 'list' && (
                    <>
                      <div className="absolute top-0 left-0 bottom-16 w-12 bg-gradient-to-r from-[#FDFCFB] to-transparent pointer-events-none"></div>
                      <div className="absolute top-0 right-0 bottom-16 w-12 bg-gradient-to-l from-[#FDFCFB] to-transparent pointer-events-none"></div>
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-white p-12 rounded-[48px] border border-slate-100 shadow-2xl prose prose-slate max-w-none">
                  <ReactMarkdown>
                    {typeof recommendation === 'string' ? recommendation : ''}
                  </ReactMarkdown>
                </div>
              )}
            </section>

            <div className="flex justify-center pt-10">
              <button
                onClick={generateRecommendation}
                className="flex items-center gap-3 text-slate-400 hover:text-indigo-600 transition-all font-black uppercase tracking-[0.2em] text-[10px]"
              >
                <Navigation className="w-4 h-4" />
                Refresh recommendations
              </button>
            </div>
          </motion.div>
        );

      case 'detail':
        if (!selectedItem) return null;
        return (
          <motion.div 
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-10"
          >
            <button 
              onClick={() => setCurrentScreen('results')}
              className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-xs hover:text-indigo-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to results
            </button>

            <div className="bg-white rounded-[56px] overflow-hidden shadow-2xl shadow-slate-200 border border-slate-100">
              <div className="h-[500px] w-full relative group">
                <div className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar scroll-smooth">
                  {(selectedItem.imageUrls && selectedItem.imageUrls.length > 0) ? (
                    selectedItem.imageUrls.map((url, idx) => (
                      <div key={idx} className="min-w-full h-full relative snap-center">
                        <Image 
                          src={url} 
                          alt={`${selectedItem.title || selectedItem.name} - ${idx + 1}`}
                          fill
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="min-w-full h-full relative snap-center">
                      <Image 
                        src={selectedItem.imageUrl || `https://picsum.photos/seed/${encodeURIComponent(selectedItem.title || selectedItem.name || 'travel')}/1200/800`} 
                        alt={selectedItem.title || selectedItem.name || 'Recommendation'}
                        fill
                        className="object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                </div>
                
                {/* Gallery Indicator */}
                {(selectedItem.imageUrls && selectedItem.imageUrls.length > 1) && (
                  <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                    {selectedItem.imageUrls.map((_, idx) => (
                      <div key={idx} className="w-2 h-2 rounded-full bg-white/50 backdrop-blur-sm"></div>
                    ))}
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none"></div>
                <div className="absolute bottom-12 left-12 right-12 pointer-events-none">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-2 text-indigo-400 font-black uppercase tracking-[0.3em] text-[10px]">
                      <Compass className="w-4 h-4" /> {selectedItem.subtitle || selectedItem.type} {selectedItem.price_level ? `• ${selectedItem.price_level}` : ''}
                    </div>
                    {selectedItem.rank && (
                      <div className="bg-indigo-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20">
                        Rank #{selectedItem.rank} {selectedItem.confidence ? `• ${selectedItem.confidence}% Confidence` : ''}
                      </div>
                    )}
                  </div>
                  <h2 className="text-6xl font-display font-black text-white tracking-tight leading-tight">{selectedItem.title || selectedItem.name}</h2>
                </div>

                {/* Swipe Hint */}
                {(selectedItem.imageUrls && selectedItem.imageUrls.length > 1) && (
                  <div className="absolute top-12 right-12 bg-white/10 backdrop-blur-md border border-white/20 px-4 py-2 rounded-full text-[10px] font-black text-white uppercase tracking-widest animate-pulse pointer-events-none">
                    Swipe for more
                  </div>
                )}
              </div>
              
              <div className="p-12 md:p-16 space-y-16">
                {selectedItem.attributes && selectedItem.attributes.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {selectedItem.attributes.map(attr => (
                      <span key={attr} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-2xl text-xs font-black uppercase tracking-widest border border-indigo-100">
                        {attr}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-3xl text-slate-600 leading-relaxed font-medium">
                  {selectedItem.reason || selectedItem.why}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 py-12 border-y border-slate-50">
                  <div className="space-y-8">
                    <div className="flex items-center gap-6 text-slate-700">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <Star className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Rating</p>
                        <span className="font-display font-black text-xl">{selectedItem.rating || 'N/A'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-slate-700">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <Clock className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Hours</p>
                        <span className="font-display font-black text-xl">{selectedItem.hours || 'N/A'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-slate-700">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <MapPin className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Address</p>
                        <span className="font-display font-black text-lg line-clamp-2 leading-tight">{selectedItem.address || 'Address not available'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-8">
                    {selectedItem.website && (
                      <div className="flex items-center gap-6 text-slate-700">
                        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                          <Globe className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Website</p>
                          <a href={selectedItem.website} target="_blank" rel="noopener noreferrer" className="font-display font-black text-lg text-indigo-600 hover:underline break-all">
                            {selectedItem.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                          </a>
                        </div>
                      </div>
                    )}
                    <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-600/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                      <h4 className="text-indigo-600 font-black uppercase tracking-[0.3em] text-[10px] mb-6 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" /> Insider Tip
                      </h4>
                      <p className="text-slate-700 text-xl italic leading-relaxed font-medium relative z-10">
                        &quot;{selectedItem.funTip || 'Ask locals for the best hidden spots nearby!'}&quot;
                      </p>
                    </div>
                  </div>
                </div>

                {selectedItem.reviews && selectedItem.reviews.length > 0 && (
                  <div className="space-y-8">
                    <h4 className="text-slate-900 font-display font-black text-2xl flex items-center gap-3">
                      <MessageSquare className="w-6 h-6 text-indigo-600" /> User Reviews
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {selectedItem.reviews.map((review, i) => (
                        <div key={i} className="p-8 rounded-[32px] bg-slate-50 border border-slate-100 space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="font-display font-black text-slate-900">{review.author}</span>
                            <div className="flex items-center gap-1.5 text-yellow-500">
                              <Star className="w-4 h-4 fill-current" />
                              <span className="text-xs font-black">{review.rating}</span>
                            </div>
                          </div>
                          <p className="text-slate-600 text-lg italic leading-relaxed">
                            &quot;{review.text}&quot;
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-6">
                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedItem.address || selectedItem.title || selectedItem.name || '')}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-4 px-10 py-7 rounded-[32px] bg-indigo-600 text-white font-display font-black uppercase tracking-widest text-sm hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-200"
                  >
                    <Navigation className="w-6 h-6" /> Get Directions
                  </a>
                  <div className="flex-1 flex gap-4">
                    <button className="flex-1 flex items-center justify-center gap-4 px-10 py-7 rounded-[32px] bg-white border border-slate-200 text-slate-600 font-display font-black uppercase tracking-widest text-sm hover:bg-slate-50 transition-all shadow-sm">
                      <Heart className="w-6 h-6" /> Save Place
                    </button>
                    <button 
                      onClick={() => handleShare(selectedItem)}
                      className="flex-1 flex items-center justify-center gap-4 px-10 py-7 rounded-[32px] bg-white border border-slate-200 text-slate-600 font-display font-black uppercase tracking-widest text-sm hover:bg-slate-50 transition-all shadow-sm relative"
                    >
                      <Share2 className="w-6 h-6" /> 
                      {showCopied ? 'Copied!' : 'Share'}
                      {showCopied && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-3 py-1.5 rounded-full font-black uppercase tracking-widest"
                        >
                          Link Copied
                        </motion.div>
                      )}
                    </button>
                  </div>
                </div>

                {currentRecId && (
                  <div className="pt-16 border-t border-slate-50 flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="flex flex-col">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Was this helpful?</p>
                      {isLearning && (
                        <span className="text-xs text-indigo-500 flex items-center gap-2 mt-2 font-black uppercase tracking-widest">
                          <Loader2 className="w-4 h-4 animate-spin" /> Optimizing your profile...
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 w-full md:w-auto">
                      <button 
                        onClick={() => selectedItem && handleFeedback(currentRecId, selectedItem.title || selectedItem.name || '', 'like')}
                        disabled={isLearning}
                        className="flex-1 md:flex-none flex items-center justify-center gap-3 px-10 py-5 rounded-2xl border border-slate-100 bg-white hover:bg-green-50 hover:border-green-200 hover:text-green-600 transition-all disabled:opacity-50 font-display font-black text-xs uppercase tracking-widest"
                      >
                        <ThumbsUp className="w-5 h-5" />
                        Helpful
                      </button>
                      <button 
                        onClick={() => selectedItem && handleFeedback(currentRecId, selectedItem.title || selectedItem.name || '', 'dislike')}
                        disabled={isLearning}
                        className="flex-1 md:flex-none flex items-center justify-center gap-3 px-10 py-5 rounded-2xl border border-slate-100 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-all disabled:opacity-50 font-display font-black text-xs uppercase tracking-widest"
                      >
                        <ThumbsDown className="w-5 h-5" />
                        Not for me
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-16 pt-16 border-t border-slate-100">
                  <h4 className="text-slate-900 font-display font-black text-2xl mb-8 flex items-center gap-3">
                    <Calendar className="w-6 h-6 text-indigo-600" /> Plan Your Visit
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {itinerary.days.map(day => (
                      <button
                        key={day.dayNumber}
                        onClick={() => {
                          addToItinerary(selectedItem, day.dayNumber);
                          setCurrentScreen('itinerary');
                        }}
                        className="flex items-center justify-between p-6 rounded-[32px] bg-slate-50 border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-indigo-600 font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all">
                            {day.dayNumber}
                          </div>
                          <span className="font-display font-black text-slate-700 uppercase tracking-widest text-[10px]">Add to Day {day.dayNumber}</span>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-600 transition-all" />
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        const nextDay = itinerary.days.length + 1;
                        setItinerary(prev => ({
                          ...prev,
                          days: [...prev.days, { dayNumber: nextDay, stops: [] }]
                        }));
                        addToItinerary(selectedItem, nextDay);
                        setCurrentScreen('itinerary');
                      }}
                      className="flex items-center justify-center gap-4 p-6 rounded-[32px] border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-600 transition-all font-display font-black uppercase tracking-widest text-[10px]"
                    >
                      <Plus className="w-4 h-4" /> Add New Day
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        );

      case 'action':
        return (
          <motion.div 
            key="action"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12"
          >
            <div className="w-40 h-40 bg-indigo-600 rounded-[48px] flex items-center justify-center shadow-2xl shadow-indigo-200 animate-pulse rotate-6">
              <Navigation className="w-20 h-20 text-white" />
            </div>
            <div className="space-y-6">
              <h2 className="text-6xl font-display font-black text-slate-900 tracking-tight leading-tight">Taking you there...</h2>
              <p className="text-slate-500 text-2xl font-medium max-w-lg mx-auto">Opening your navigation app and preparing your journey.</p>
            </div>
            <button 
              onClick={() => setCurrentScreen('results')}
              className="px-12 py-6 rounded-[32px] bg-white border border-slate-100 text-slate-600 font-display font-black uppercase tracking-widest text-sm hover:bg-slate-50 transition-all shadow-xl"
            >
              View Backup Options
            </button>
          </motion.div>
        );

      case 'itinerary':
        return (
          <motion.div 
            key="itinerary"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-6xl mx-auto space-y-12 pb-24"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="space-y-4">
                <button 
                  onClick={() => setCurrentScreen('results')}
                  className="flex items-center gap-2 text-indigo-600 font-black uppercase tracking-widest text-[10px] hover:gap-4 transition-all"
                >
                  <ArrowLeft className="w-4 h-4" /> Back to Results
                </button>
                <div className="flex items-center gap-4">
                  <input 
                    type="text"
                    value={itinerary.title}
                    onChange={(e) => setItinerary(prev => ({ ...prev, title: e.target.value }))}
                    className="text-5xl font-display font-black text-slate-900 bg-transparent border-none outline-none focus:ring-0 p-0 w-full"
                  />
                  <Edit3 className="w-8 h-8 text-slate-200" />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <button 
                  onClick={() => {
                    setItinerary({
                      title: 'My Adventure',
                      days: [{ dayNumber: 1, stops: [] }]
                    });
                  }}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-white border border-slate-200 text-red-500 font-display font-black uppercase tracking-widest text-xs hover:bg-red-50 hover:border-red-200 transition-all shadow-sm"
                >
                  <Trash2 className="w-5 h-5" /> Clear All
                </button>
                <button 
                  onClick={exportItinerary}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-white border border-slate-200 text-slate-600 font-display font-black uppercase tracking-widest text-xs hover:bg-slate-50 transition-all shadow-sm"
                >
                  <Download className="w-5 h-5" /> Export
                </button>
                <button 
                  onClick={saveItinerary}
                  disabled={isSavingItinerary}
                  className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-indigo-600 text-white font-display font-black uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 disabled:opacity-50"
                >
                  {isSavingItinerary ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {saveSuccess ? 'Saved!' : 'Save Plan'}
                </button>
              </div>
            </div>

            <div className="space-y-12">
              {itinerary.days.map((day, dayIdx) => (
                <div key={day.dayNumber} className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <div className="flex flex-col gap-1">
                        <button 
                          disabled={dayIdx === 0}
                          onClick={() => {
                            setItinerary(prev => {
                              const newDays = [...prev.days];
                              [newDays[dayIdx], newDays[dayIdx - 1]] = [newDays[dayIdx - 1], newDays[dayIdx]];
                              return {
                                ...prev,
                                days: newDays.map((d, i) => ({ ...d, dayNumber: i + 1 }))
                              };
                            });
                          }}
                          className="p-1 rounded hover:bg-slate-100 text-slate-300 hover:text-indigo-600 disabled:opacity-0 transition-all"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <div className="w-16 h-16 rounded-3xl bg-indigo-600 text-white flex items-center justify-center font-display font-black text-2xl shadow-xl shadow-indigo-100">
                          {day.dayNumber}
                        </div>
                        <button 
                          disabled={dayIdx === itinerary.days.length - 1}
                          onClick={() => {
                            setItinerary(prev => {
                              const newDays = [...prev.days];
                              [newDays[dayIdx], newDays[dayIdx + 1]] = [newDays[dayIdx + 1], newDays[dayIdx]];
                              return {
                                ...prev,
                                days: newDays.map((d, i) => ({ ...d, dayNumber: i + 1 }))
                              };
                            });
                          }}
                          className="p-1 rounded hover:bg-slate-100 text-slate-300 hover:text-indigo-600 disabled:opacity-0 transition-all"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                      <h3 className="text-3xl font-display font-black text-slate-900 uppercase tracking-tight">Day {day.dayNumber}</h3>
                    </div>
                    <button 
                      onClick={() => {
                        setItinerary(prev => {
                          const filteredDays = prev.days.filter(d => d.dayNumber !== day.dayNumber);
                          return {
                            ...prev,
                            days: filteredDays.map((d, i) => ({ ...d, dayNumber: i + 1 }))
                          };
                        });
                      }}
                      className="p-4 rounded-2xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    {day.stops.length === 0 ? (
                      <div className="p-12 rounded-[40px] border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-center space-y-4">
                        <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                          <MapPin className="w-8 h-8" />
                        </div>
                        <p className="text-slate-400 font-medium">No stops added to this day yet.</p>
                      </div>
                    ) : (
                      day.stops.map((stop, stopIdx) => (
                        <div key={stop.id} className="group relative bg-white p-8 rounded-[40px] border border-slate-100 hover:border-indigo-200 hover:shadow-2xl hover:shadow-indigo-50 transition-all flex flex-col md:flex-row gap-8 items-start">
                          <div className="flex flex-col items-center gap-4">
                            <button 
                              disabled={stopIdx === 0}
                              onClick={() => {
                                const newStops = [...day.stops];
                                [newStops[stopIdx], newStops[stopIdx - 1]] = [newStops[stopIdx - 1], newStops[stopIdx]];
                                setItinerary(prev => {
                                  const newDays = [...prev.days];
                                  newDays[dayIdx].stops = newStops;
                                  return { ...prev, days: newDays };
                                });
                              }}
                              className="p-2 rounded-lg hover:bg-slate-50 text-slate-300 hover:text-indigo-600 disabled:opacity-0 transition-all"
                            >
                              <ChevronUp className="w-5 h-5" />
                            </button>
                            <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 font-black text-xs">
                              {stopIdx + 1}
                            </div>
                            <button 
                              disabled={stopIdx === day.stops.length - 1}
                              onClick={() => {
                                const newStops = [...day.stops];
                                [newStops[stopIdx], newStops[stopIdx + 1]] = [newStops[stopIdx + 1], newStops[stopIdx]];
                                setItinerary(prev => {
                                  const newDays = [...prev.days];
                                  newDays[dayIdx].stops = newStops;
                                  return { ...prev, days: newDays };
                                });
                              }}
                              className="p-2 rounded-lg hover:bg-slate-50 text-slate-300 hover:text-indigo-600 disabled:opacity-0 transition-all"
                            >
                              <ChevronDown className="w-5 h-5" />
                            </button>
                          </div>

                          <div className="flex-1 space-y-6 w-full">
                            <div className="flex items-center justify-between">
                              <h4 className="text-2xl font-display font-black text-slate-900">{stop.title}</h4>
                              <button 
                                onClick={() => {
                                  setItinerary(prev => {
                                    const newDays = [...prev.days];
                                    newDays[dayIdx].stops = day.stops.filter(s => s.id !== stop.id);
                                    return { ...prev, days: newDays };
                                  });
                                }}
                                className="p-3 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                            
                            <div className="space-y-2">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <StickyNote className="w-3 h-3" /> Notes
                              </label>
                              <textarea 
                                value={stop.notes}
                                onChange={(e) => {
                                  const newStops = [...day.stops];
                                  newStops[stopIdx].notes = e.target.value;
                                  setItinerary(prev => {
                                    const newDays = [...prev.days];
                                    newDays[dayIdx].stops = newStops;
                                    return { ...prev, days: newDays };
                                  });
                                }}
                                placeholder="Add reminders, reservation times, or things to see..."
                                className="w-full bg-slate-50 border-none rounded-2xl p-4 text-slate-600 text-sm focus:ring-2 focus:ring-indigo-500/20 min-h-[100px] resize-none"
                              />
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}

              <button 
                onClick={() => {
                  setItinerary(prev => ({
                    ...prev,
                    days: [...prev.days, { dayNumber: prev.days.length + 1, stops: [] }]
                  }));
                }}
                className="w-full py-12 rounded-[48px] border-2 border-dashed border-slate-100 text-slate-400 hover:border-indigo-200 hover:text-indigo-600 hover:bg-indigo-50/30 transition-all flex flex-col items-center justify-center gap-4 group"
              >
                <div className="w-16 h-16 rounded-3xl bg-slate-50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all">
                  <Plus className="w-8 h-8" />
                </div>
                <span className="font-display font-black uppercase tracking-[0.2em] text-sm">Add Another Day</span>
              </button>
            </div>
          </motion.div>
        );

      default:
        return null;
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-slate-50">
        <div className="w-24 h-24 bg-blue-600 rounded-[32px] flex items-center justify-center mb-10 shadow-2xl shadow-blue-200">
          <Compass className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-5xl font-bold mb-6 tracking-tight text-slate-900">WanderWise AI</h1>
        <p className="text-slate-500 max-w-md mb-10 text-xl font-medium leading-relaxed">
          Your agentic travel companion. Sign in to get location-aware recommendations tailored just for you.
        </p>
        <button 
          onClick={signIn}
          className="flex items-center gap-4 bg-white border border-slate-200 px-10 py-5 rounded-[24px] font-bold text-lg shadow-xl shadow-slate-100 hover:shadow-2xl transition-all hover:bg-slate-50 active:scale-95"
        >
          <LogIn className="w-6 h-6 text-blue-600" />
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      <header className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between">
        <div 
          onClick={() => setCurrentScreen('home')}
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-100 group-hover:scale-110 transition-transform">
            <Compass className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-900">WANDERWISE</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end mr-2">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{user?.displayName}</p>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Explorer Level 1</p>
          </div>
          <button 
            onClick={logout}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:bg-white hover:text-red-500 rounded-2xl transition-all hover:shadow-lg border border-transparent hover:border-slate-100"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">
          {renderScreen()}
        </AnimatePresence>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-200/50 text-center">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-2 text-slate-300">
            <Compass className="w-5 h-5" />
            <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
            <Sparkles className="w-5 h-5" />
            <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
            <Navigation className="w-5 h-5" />
          </div>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-[0.3em]">Agentic NearMe Travel MVP • 2026</p>
        </div>
      </footer>
    </div>
  );
}
