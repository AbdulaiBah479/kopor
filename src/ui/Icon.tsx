// Icons from Lucide (lucide.dev, ISC licence). Screens use short names; each icon is imported
// individually so only the icons used end up in the app.
import {
  House, NotebookText, Banknote, Package, LayoutGrid, Users, FileText, Activity, SlidersHorizontal, Mic, Plus, Minus,
  MessageCircle, MessageSquareText, Phone, Search, ChevronLeft, ChevronRight, TriangleAlert, Printer, Share2, Check, Trash2,
  Pencil, ArrowUpRight, ArrowDownLeft, Sparkles, Lock, Download, Upload, Landmark, X, Camera, Bell, Send, Globe, Cloud,
  ShieldCheck, List, Store, Link, CircleHelp, Crown, ScanBarcode, Contact, Delete, RefreshCw, Undo2, Wallet, TrendingUp, TrendingDown,
  Copy, QrCode, Info, Smartphone, WifiOff, KeyRound, ArrowLeftRight, Square, Palette, Sun, Moon, SunMoon, Type,
  Bus, Building2, Zap, Fuel, UtensilsCrossed, Wrench, Receipt, HandCoins, ShoppingBag, Tag,
  CalendarDays, Eye, EyeOff, MapPin, type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  home: House, calendar: CalendarDays, eye: Eye, eyeOff: EyeOff, pin: MapPin, book: NotebookText, cash: Banknote, box: Package, grid: LayoutGrid, users: Users, file: FileText, pulse: Activity,
  sliders: SlidersHorizontal, mic: Mic, plus: Plus, minus: Minus, chat: MessageCircle, sms: MessageSquareText, phone: Phone,
  search: Search, back: ChevronLeft, chev: ChevronRight, alert: TriangleAlert, print: Printer, share: Share2, check: Check,
  trash: Trash2, edit: Pencil, up: ArrowUpRight, down: ArrowDownLeft, spark: Sparkles, lock: Lock, download: Download,
  upload: Upload, bank: Landmark, x: X, camera: Camera, bell: Bell, send: Send, globe: Globe, cloud: Cloud, shield: ShieldCheck,
  list: List, store: Store, link: Link, help: CircleHelp, crown: Crown, barcode: ScanBarcode, contact: Contact, backspace: Delete,
  refresh: RefreshCw, undo: Undo2, wallet: Wallet, trendUp: TrendingUp, trendDown: TrendingDown,
  copy: Copy, qr: QrCode, info: Info, install: Smartphone, offline: WifiOff, key: KeyRound, swap: ArrowLeftRight, stop: Square, palette: Palette, sun: Sun, moon: Moon, auto: SunMoon, text: Type,
  bus: Bus, building: Building2, zap: Zap, fuel: Fuel, food: UtensilsCrossed, wrench: Wrench, receipt: Receipt, coins: HandCoins, bag: ShoppingBag, tag: Tag,
};

export function Icon({ name, size = 20, className = '', strokeWidth = 2 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  const C = ICONS[name] ?? CircleHelp;
  return <C className={`ic ${className}`} size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
}
