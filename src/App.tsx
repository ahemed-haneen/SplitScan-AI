/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { User, LogOut, Camera, Plus, Check, Loader2, ChevronRight, Users, User as UserIcon, RefreshCw, Star, Search, X, ArrowLeft, Languages } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { scanReceipt, translateText } from "./lib/gemini";
import type { ReceiptData, SplitwiseGroup, SplitwiseUser } from "./types";

type Step = "auth" | "dashboard" | "group-view" | "scanning" | "review" | "success";

const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("splitwiseToken");
  const headers = { ...options.headers };
  if (token) {
    (headers as any)["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
};

export default function App() {
  const [step, setStep] = useState<Step>("auth");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<SplitwiseUser | null>(null);
  const [groups, setGroups] = useState<SplitwiseGroup[]>([]);
  const [friends, setFriends] = useState<SplitwiseUser[]>([]);
  
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptData | null>(null);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<{ id: number; type: "group" | "friend"; name: string; members: SplitwiseUser[] } | null>(null);
  
  const [favoriteGroupIds, setFavoriteGroupIds] = useState<number[]>(() => {
    const saved = localStorage.getItem("favoriteGroupIds");
    return saved ? JSON.parse(saved) : [];
  });
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    localStorage.setItem("favoriteGroupIds", JSON.stringify(favoriteGroupIds));
  }, [favoriteGroupIds]);

  const toggleFavorite = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setFavoriteGroupIds(prev => 
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  const getIsActive = (g: SplitwiseGroup) => {
    const hasDebts = ((g as any).original_debts && (g as any).original_debts.length > 0) || 
                     ((g as any).simplified_debts && (g as any).simplified_debts.length > 0);
    
    // If updated in the last 7 days, consider active even if debts are zero
    const updatedAt = new Date(g.updated_at).getTime();
    const isRecentlyUpdated = (Date.now() - updatedAt) < (7 * 24 * 60 * 60 * 1000);
    
    const isDeleted = (g as any).group_type === 'trash' || (g as any).group_type === 'deleted';
    
    return !isDeleted && (hasDebts || isRecentlyUpdated);
  };

  const favoriteGroups = groups.filter(g => favoriteGroupIds.includes(g.id)).filter(g => {
    if (showInactive) return true;
    return getIsActive(g);
  });
  
  const getFilteredGroups = () => {
    return groups.filter(g => {
      const matchesSearch = g.name.toLowerCase().includes(groupSearch.toLowerCase());
      const isDeleted = (g as any).group_type === 'trash' || (g as any).group_type === 'deleted';
      
      if (showInactive) return matchesSearch && !isDeleted;
      
      return matchesSearch && getIsActive(g);
    });
  };

  const filteredGroups = getFilteredGroups();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const tokenInUrl = new URLSearchParams(window.location.search).get("token");
      if (tokenInUrl) {
        localStorage.setItem("splitwiseToken", tokenInUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const res = await apiFetch("/api/auth/status");
      const { isAuthenticated } = await res.json();
      setIsAuthenticated(isAuthenticated);
      if (isAuthenticated) {
        setStep("dashboard");
        fetchInitialData();
      }
    } catch (error) {
      console.error("Auth check failed", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInitialData = async () => {
    setError(null);
    setIsDataLoading(true);
    try {
      const [userRes, groupsRes, friendsRes] = await Promise.all([
        apiFetch("/api/splitwise/get_current_user"),
        apiFetch("/api/splitwise/get_groups"),
        apiFetch("/api/splitwise/get_friends"),
      ]);

      if (userRes.status === 401 || groupsRes.status === 401 || friendsRes.status === 401) {
        console.warn("Unauthorized (401). Clearing session and prompting login.");
        await handleLogout();
        return;
      }

      if (!userRes.ok || !groupsRes.ok || !friendsRes.ok) {
        throw new Error("One or more requests failed with status: " + [userRes.status, groupsRes.status, friendsRes.status].join(", "));
      }

      const userData = await userRes.json();
      const groupsData = await groupsRes.json();
      const friendsData = await friendsRes.json();

      setCurrentUser(userData.user);
      
      const fetchedGroups = Array.isArray(groupsData) ? groupsData : (groupsData.groups || []);
      const fetchedFriends = Array.isArray(friendsData) ? friendsData : (friendsData.friends || []);

      setGroups(fetchedGroups);
      setFriends(fetchedFriends);
    } catch (error: any) {
      console.error("Data fetch failed", error);
      setError("Failed to sync your Splitwise data. Please check your connection or try logging in again.");
    } finally {
      setIsDataLoading(false);
    }
  };

  const handleLogin = async () => {
    const res = await apiFetch("/api/auth/url");
    const { url } = await res.json();
    const authWindow = window.open(url, "_blank", "width=600,height=700");
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        if (event.data.token) {
          localStorage.setItem("splitwiseToken", event.data.token);
        }
        setIsAuthenticated(true);
        setStep("dashboard");
        fetchInitialData();
        window.removeEventListener("message", handleMessage);
      }
    };
    window.addEventListener("message", handleMessage);
  };

  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("splitwiseToken");
    setIsAuthenticated(false);
    setStep("auth");
  };

  const handleTargetSelect = (id: number, type: "group" | "friend", name: string, members: SplitwiseUser[]) => {
    setSelectedTarget({ id, type, name, members });
    setStep("group-view");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedTarget) {
      alert("Please select a group or friend first.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setReceiptImage(base64);
      setIsScanning(true);
      setStep("scanning");

      try {
        const data = await scanReceipt(base64, file.type);
        setSelectedReceipt(data);
        setStep("review");
      } catch (error) {
        console.error("Scanning failed", error);
        alert("Failed to scan receipt. Please try again.");
        setStep("dashboard");
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-main">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main font-sans text-neutral-200">
      <AnimatePresence mode="wait">
        {step === "auth" && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex min-h-screen flex-col items-center justify-center p-6 bg-bg-main"
          >
            <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <Plus className="h-10 w-10" />
            </div>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">SplitScan</h1>
            <p className="mb-8 text-center text-neutral-500 max-w-xs">
              Collect bills, scan receipts and sync expenses with your Splitwise groups instantly.
            </p>
            <button
              onClick={handleLogin}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-neutral-100 py-4 text-lg font-bold text-black shadow-lg transition-transform active:scale-95 hover:bg-white"
            >
              Connect Splitwise
            </button>
          </motion.div>
        )}

        {step === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="pb-24 max-w-lg mx-auto bg-bg-card min-h-screen shadow-2xl border-x border-border-card"
          >
            <header className="sticky top-0 z-10 bg-bg-card/80 p-6 backdrop-blur-lg border-b border-border-card">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[10px] uppercase tracking-[0.2em] text-emerald-500 font-bold">SplitSync Pro</h2>
                  <h3 className="text-xl font-medium text-white">{currentUser?.first_name}'s Hub</h3>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-item border border-border-item hover:bg-neutral-800 transition-colors"
                >
                  <LogOut className="h-5 w-5 text-neutral-400" />
                </button>
              </div>
            </header>

            <main className="px-6 py-8 space-y-10">
              {error && (
                <div className="rounded-xl bg-red-500/10 p-4 border border-red-500/20 text-red-400 text-xs">
                  {error}
                  <button 
                    onClick={() => { setError(null); fetchInitialData(); }}
                    className="ml-3 font-bold underline"
                  >
                    Retry
                  </button>
                </div>
              )}



              <section>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Pinned Groups</h4>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setShowAllGroups(true)}
                      className="text-[10px] font-bold text-emerald-500 hover:underline px-2"
                    >
                      View All
                    </button>
                    <button 
                      onClick={fetchInitialData}
                      disabled={isDataLoading}
                      className="p-1 hover:bg-neutral-800 rounded-md transition-colors disabled:opacity-50"
                      title="Refresh data"
                    >
                      <RefreshCw className={`h-3 w-3 text-neutral-500 ${isDataLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {isDataLoading ? (
                    <div className="flex h-16 items-center justify-center rounded-2xl bg-bg-item border border-border-item animate-pulse">
                      <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                    </div>
                  ) : favoriteGroups.length > 0 ? (
                    favoriteGroups.map((group, idx) => (
                      <div
                        key={`${group.id}-pin-${idx}`}
                        className={`w-full flex items-center justify-between rounded-2xl bg-bg-item p-2.5 border transition-all group ${selectedTarget?.id === group.id && selectedTarget?.type === 'group' ? 'border-emerald-500 bg-emerald-500/5' : 'border-border-item hover:border-emerald-500/30'}`}
                      >
                        <button
                          onClick={() => handleTargetSelect(group.id, "group", group.name, group.members)}
                          className="flex flex-1 items-center gap-2.5 text-left mr-2.5"
                        >
                          <div className={`flex h-9 w-9 items-center justify-center rounded-xl border text-emerald-500 transition-colors ${selectedTarget?.id === group.id ? 'bg-emerald-500 text-black border-emerald-500' : 'bg-bg-main border-border-card'}`}>
                            <Users className="h-4.5 w-4.5" />
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold transition-colors truncate ${selectedTarget?.id === group.id ? 'text-emerald-400' : 'text-neutral-200 group-hover:text-emerald-400'}`}>{group.name}</p>
                            <p className="text-[9px] text-neutral-500 font-mono">
                              {group.members.length} members
                            </p>
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={(e) => toggleFavorite(e, group.id)}
                            className="p-1.5 -m-1.5 opacity-100 transition-colors hover:text-emerald-500"
                          >
                            <Star className={`h-3.5 w-3.5 ${favoriteGroupIds.includes(group.id) ? 'fill-emerald-500 text-emerald-500' : 'text-neutral-600'}`} />
                          </button>
                          <ChevronRight className={`h-4 w-4 transition-colors ${selectedTarget?.id === group.id ? 'text-emerald-500' : 'text-neutral-600 group-hover:text-emerald-500'}`} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-neutral-600 italic py-8 text-center border border-dashed border-neutral-800 rounded-2xl">
                      <Star className="h-8 w-8 text-neutral-800 mx-auto mb-2" />
                      <p>Star your favorite groups to see them here.</p>
                      <button 
                        onClick={() => setShowAllGroups(true)}
                        className="mt-4 text-xs font-bold text-emerald-500 hover:underline"
                      >
                        Browse all groups
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Frequent Friends</h4>
                {isDataLoading ? (
                  <div className="grid grid-cols-4 gap-3">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="flex flex-col items-center gap-1.5 animate-pulse">
                        <div className="h-12 w-12 rounded-full bg-bg-item border border-border-item" />
                        <div className="h-1.5 w-8 bg-bg-item rounded" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-3">
                    {friends.slice(0, 8).map((friend, idx) => (
                      <button 
                        key={`${friend.id}-friend-${idx}`}
                        onClick={() => {
                          const members = [currentUser!];
                          if (friend.id !== currentUser!.id) {
                            members.push(friend);
                          }
                          handleTargetSelect(friend.id, "friend", friend.first_name, members);
                        }}
                        className={`flex flex-col items-center gap-1.5 group p-1.5 rounded-2xl transition-all ${selectedTarget?.id === friend.id && selectedTarget?.type === 'friend' ? 'bg-emerald-500/10 ring-1 ring-emerald-500' : 'hover:bg-neutral-800'}`}
                      >
                         <div className={`h-12 w-12 overflow-hidden rounded-full border p-0.5 shadow-sm transition-colors ${selectedTarget?.id === friend.id ? 'border-emerald-500' : 'border-border-item bg-bg-item'}`}>
                            {friend.picture.medium ? (
                              <img src={friend.picture.medium} alt={friend.first_name} className="h-full w-full object-cover rounded-full" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-bg-main text-neutral-500 rounded-full">
                                <UserIcon className="h-5 w-5" />
                              </div>
                            )}
                         </div>
                         <p className={`w-full truncate text-center text-[9px] font-medium transition-colors ${selectedTarget?.id === friend.id ? 'text-emerald-400' : 'text-neutral-400 group-hover:text-emerald-200'}`}>
                           {friend.first_name}
                         </p>
                      </button>
                    ))}
                  </div>
                )}
                {!isDataLoading && friends.length === 0 && (
                   <p className="text-sm text-neutral-600 italic py-4 text-center border border-dashed border-neutral-800 rounded-2xl w-full">No friends found.</p>
                )}
              </section>
            </main>

            {/* Float Action Button - No longer needed on dashboard as it moves to group-view */}
          </motion.div>
        )}

        {/* All Groups Modal */}
        <AnimatePresence>
          {showAllGroups && (
            <motion.div
              key="all-groups"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed inset-0 z-50 flex flex-col bg-bg-card h-full"
            >
              <header className="flex items-center justify-between p-6 border-b border-border-card">
                <button onClick={() => setShowAllGroups(false)} className="p-2 -ml-2 text-neutral-500">
                   <ChevronRight className="h-6 w-6 rotate-180" />
                </button>
                <h2 className="text-lg font-medium text-white">Select Group</h2>
                <div className="w-10"></div>
              </header>

              <div className="flex-1 overflow-hidden flex flex-col p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                    <input 
                      type="text"
                      placeholder="Search groups..."
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      className="w-full bg-bg-item border border-border-item rounded-2xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                    {groupSearch && (
                      <button 
                        onClick={() => setGroupSearch("")}
                        className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500"
                      >
                        <X className="h-full w-full" />
                      </button>
                    )}
                  </div>
                  <button 
                    onClick={() => setShowInactive(!showInactive)}
                    className={`px-3 py-3 rounded-2xl border text-[10px] font-bold uppercase tracking-widest transition-all ${showInactive ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-border-item bg-bg-item text-neutral-500'}`}
                  >
                    {showInactive ? 'Hide Settled' : 'Show Settled'}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pb-20 pr-1">
                  {filteredGroups.length > 0 ? (
                    filteredGroups.map((group, idx) => (
                      <div
                        key={`${group.id}-all-${idx}`}
                        className="flex items-center justify-between rounded-2xl bg-bg-item p-3 border border-border-item transition-all hover:border-emerald-500/30 group"
                      >
                        <button
                          onClick={() => {
                            handleTargetSelect(group.id, "group", group.name, group.members);
                            setShowAllGroups(false);
                          }}
                          className="flex flex-1 items-center gap-3 text-left mr-3"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-main border border-border-card text-emerald-500">
                             <Users className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-neutral-200 group-hover:text-emerald-400 transition-colors truncate">{group.name}</p>
                            <p className="text-[9px] text-neutral-500 uppercase font-bold tracking-widest">{group.members.length} members</p>
                          </div>
                        </button>
                        <button 
                          onClick={(e) => toggleFavorite(e, group.id)}
                          className="p-1.5 -m-1.5 transition-colors hover:text-emerald-500"
                        >
                          <Star className={`h-3.5 w-3.5 ${favoriteGroupIds.includes(group.id) ? 'fill-emerald-500 text-emerald-500' : 'text-neutral-600'}`} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-20 text-neutral-500">
                       <p>No groups matching "{groupSearch}"</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {step === "group-view" && selectedTarget && (
          <GroupView 
            key="group-view"
            target={selectedTarget}
            currentUser={currentUser!}
            onBack={() => {
              setStep("dashboard");
              setSelectedTarget(null);
            }}
            onScan={handleFileUpload}
          />
        )}

        {step === "scanning" && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0A0A0A]/95 p-12 text-neutral-200"
          >
            <div className="relative mb-8 h-64 w-64 overflow-hidden rounded-3xl border-2 border-neutral-800">
              {receiptImage && <img src={receiptImage} className="h-full w-full object-cover opacity-30 blur-md" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
                <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-500 font-bold">OCR Syncing</span>
              </div>
              <motion.div 
                className="absolute left-0 right-0 h-1 bg-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                animate={{ top: ["0%", "100%", "0%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <h2 className="text-xl font-medium tracking-tight">Extracting Intel</h2>
            <p className="mt-2 text-center text-neutral-500 text-sm">Gemini is processing the bill metadata for {selectedTarget?.name}...</p>
          </motion.div>
        )}

         {step === "review" && (
          <ReviewScreen 
             key="review"
             receipt={selectedReceipt!} 
             image={receiptImage!}
             target={selectedTarget!}
             groups={groups}
             friends={friends}
             currentUser={currentUser!}
             onCancel={() => setStep("dashboard")}
             onSuccess={() => setStep("success")}
          />
        )}

        {step === "success" && (
           <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-bg-main"
          >
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-black shadow-[0_0_30px_rgba(16,185,129,0.4)]">
              <Check className="h-10 w-10" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Sync Complete</h2>
            <p className="mt-2 text-neutral-500 max-w-xs">Your expense details have been securely pushed to Splitwise.</p>
            <button
              onClick={() => {
                setSelectedTarget(null);
                setStep("dashboard");
              }}
              className="mt-10 rounded-2xl bg-neutral-100 px-10 py-3 font-bold text-black transition-all hover:bg-white active:scale-95"
            >
              Back to Hub
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GroupView({ 
  target, 
  currentUser,
  onBack, 
  onScan 
}: { 
  target: { id: number; type: "group" | "friend"; name: string; members: SplitwiseUser[] },
  currentUser: SplitwiseUser,
  onBack: () => void,
  onScan: (e: React.ChangeEvent<HTMLInputElement>) => void,
  key?: string
}) {
  const getBalanceInfo = (member: any) => {
    const balance = member.balance?.[0];
    if (!balance) return null;
    const amount = parseFloat(balance.amount);
    return { amount, currency: balance.currency_code };
  };

  const userBalance = (target.members.find(m => m.id === currentUser.id) as any)?.balance?.[0];
  const userAmount = userBalance ? parseFloat(userBalance.amount) : 0;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-40 bg-bg-card flex flex-col max-w-lg mx-auto shadow-2xl border-x border-border-card"
    >
      <header className="flex items-center justify-between p-4 border-b border-border-card bg-bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <button onClick={onBack} className="p-1.5 -ml-1 text-neutral-500 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <h1 className="text-[9px] uppercase tracking-[0.2em] text-emerald-500 font-bold">Group Space</h1>
          <h2 className="text-base font-medium text-white max-w-[150px] truncate">{target.name}</h2>
        </div>
        <div className="w-9"></div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6 pb-24">
        <section className="bg-bg-item rounded-2xl p-5 border border-border-item text-center space-y-1 shadow-lg">
           <div className="mx-auto h-14 w-14 flex items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 mb-3">
              {target.type === "group" ? <Users className="h-7 w-7" /> : <UserIcon className="h-7 w-7" />}
           </div>
           <h3 className="text-xl font-bold text-white leading-tight">{target.name}</h3>
           <p className="text-neutral-500 text-xs">{target.members.length} members in this circle</p>
           
           <div className="pt-4 mt-4 border-t border-neutral-800 grid grid-cols-2 gap-3">
              <div className="text-left">
                  <p className="text-[7px] font-bold text-neutral-600 uppercase tracking-widest mb-0.5">Status</p>
                  <div className="flex items-center gap-1.5">
                     <div className={`h-1.5 w-1.5 rounded-full shadow-[0_0_6px_rgba(16,185,129,0.4)] ${Math.abs(userAmount) < 0.01 ? 'bg-neutral-500' : (userAmount > 0 ? 'bg-emerald-500' : 'bg-orange-500')}`} />
                     <p className="text-[10px] font-bold text-neutral-200">
                       {Math.abs(userAmount) < 0.01 ? 'Settled Up' : (userAmount > 0 ? 'Owed' : 'Owing')}
                     </p>
                  </div>
              </div>
              <div className="text-right">
                  <p className="text-[7px] font-bold text-neutral-600 uppercase tracking-widest mb-0.5">Your Balance</p>
                  <p className={`text-[10px] font-bold font-mono ${userAmount >= 0 ? 'text-emerald-500' : 'text-orange-500'}`}>
                    {userBalance ? `${userBalance.amount} ${userBalance.currency_code}` : '0.00'}
                  </p>
              </div>
           </div>
        </section>

        <section className="space-y-3">
           <div className="flex items-center justify-between">
              <h4 className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">Member Roll Call</h4>
              <span className="text-[9px] font-mono text-emerald-500/50 bg-emerald-500/5 px-1.5 py-0.5 rounded ring-1 ring-emerald-500/10">Syncing</span>
           </div>
           <div className="space-y-2">
              {target.members.map((member, idx) => {
                const balance = getBalanceInfo(member);
                return (
                  <div key={`${member.id}-view-${idx}`} className="flex items-center justify-between p-3 bg-bg-item rounded-2xl border border-border-item group hover:border-emerald-500/30 transition-all">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 overflow-hidden rounded-full border border-neutral-700 p-0.5 group-hover:border-emerald-500/40 transition-colors">
                         {member.picture.medium ? (
                           <img src={member.picture.medium} className="h-full w-full object-cover rounded-full" />
                         ) : (
                           <div className="h-full w-full flex items-center justify-center bg-bg-main text-neutral-500 rounded-full">
                             <UserIcon className="h-4 w-4" />
                           </div>
                         )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate max-w-[120px]">{member.id === currentUser.id ? 'You' : `${member.first_name} ${member.last_name || ''}`}</p>
                        {balance ? (
                          <p className={`text-[10px] font-bold font-mono ${balance.amount >= 0 ? 'text-emerald-500' : 'text-orange-500'}`}>
                            {balance.amount > 0 ? '+' : ''}{balance.amount.toFixed(2)} {balance.currency}
                          </p>
                        ) : (
                          <p className="text-[10px] text-neutral-500 font-mono italic">Settled up</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className={`text-[8px] font-bold uppercase tracking-widest ${balance && balance.amount !== 0 ? (balance.amount > 0 ? 'text-emerald-500/50' : 'text-orange-500/50') : 'text-neutral-500'}`}>
                        {balance && balance.amount !== 0 ? (balance.amount > 0 ? 'Takes' : 'Gives') : 'Clear'}
                      </p>
                      <div className="h-6 px-2 flex items-center justify-center rounded-lg bg-neutral-800 text-neutral-500 text-[10px] font-bold font-mono">
                         #{String(member.id).slice(-4)}
                      </div>
                    </div>
                  </div>
                );
              })}
           </div>
        </section>
      </div>

      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-30">
        <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-emerald-500 text-black shadow-[0_20px_50px_rgba(16,185,129,0.4)] transition-all active:scale-95 hover:scale-105 ring-4 ring-bg-card/50">
          <Camera className="h-7 w-7" />
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onScan} />
        </label>
      </div>
    </motion.div>
  );
}

function ReviewScreen({ 
  receipt, 
  image, 
  target: initialTarget, 
  groups,
  friends,
  currentUser, 
  onCancel, 
  onSuccess 
}: { 
  receipt: ReceiptData, 
  image: string,
  target: { id: number; type: "group" | "friend"; name: string; members: SplitwiseUser[] },
  groups: SplitwiseGroup[],
  friends: SplitwiseUser[],
  currentUser: SplitwiseUser,
  onCancel: () => void,
  onSuccess: () => void,
  key?: string
}) {
  const [target, setTarget] = useState(initialTarget);
  const [showTargetSelector, setShowTargetSelector] = useState(false);

  const convertToYYYYMMDD = (val: string) => {
    const parts = val.split(/[/-]/);
    if (parts.length !== 3) return val;
    let d = parts[0];
    let m = parts[1];
    let y = parts[2];
    if (d.length === 4) return `${d}-${m.padStart(2, '0')}-${y.padStart(2, '0')}`;
    if (y.length === 2) y = "20" + y;
    while (y.length < 4) y = "0" + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  };

  const formatToDDMMYY = (isoDate: string) => {
    if (!isoDate) return "";
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`;
  };

  const [dateInput, setDateInput] = useState(formatToDDMMYY(receipt.date || new Date().toISOString().split('T')[0]));
  const [formData, setFormData] = useState({
    description: receipt.merchant,
    date: receipt.date || new Date().toISOString().split('T')[0],
    currency_code: receipt.currency || "USD"
  });

  const handleDateChange = (val: string) => {
    setDateInput(val);
    const converted = convertToYYYYMMDD(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(converted)) {
      setFormData(prev => ({ ...prev, date: converted }));
    }
  };

  // itemIndex -> array of userIds
  const [itemSplits, setItemSplits] = useState<Record<number, number[]>>(() => {
    const initial: Record<number, number[]> = {};
    const memberIds = target.members.map(m => m.id);
    receipt.items.forEach((_, idx) => {
      // By default, everyone shares every item
      initial[idx] = [...memberIds];
    });
    return initial;
  });

  // Reset item splits when target changes
  useEffect(() => {
    const next: Record<number, number[]> = {};
    const memberIds = target.members.map(m => m.id);
    receipt.items.forEach((_, idx) => {
      next[idx] = [...memberIds];
    });
    setItemSplits(next);
  }, [target.id, target.type, receipt.items]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Custom name persistence
  const [nameMappings, setNameMappings] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('receipt_name_mappings');
    return saved ? JSON.parse(saved) : {};
  });

  const [editableItems, setEditableItems] = useState(receipt.items.map(item => ({
    ...item,
    name: nameMappings[item.name] || item.name
  })));

  const [translatingIdx, setTranslatingIdx] = useState<number | null>(null);

  // Currency Conversion State
  const [useSplitCurrency, setUseSplitCurrency] = useState(() => {
    const saved = localStorage.getItem(`splitwise_use_split_curr_${target.id}_${target.type}`);
    return saved === 'true';
  });
  const [splitCurrency, setSplitCurrency] = useState(() => {
    const saved = localStorage.getItem(`splitwise_split_curr_${target.id}_${target.type}`);
    return saved || "USD";
  });
  const [splitTotal, setSplitTotal] = useState<string>("");

  // Persist currency settings
  useEffect(() => {
    localStorage.setItem(`splitwise_use_split_curr_${target.id}_${target.type}`, String(useSplitCurrency));
    localStorage.setItem(`splitwise_split_curr_${target.id}_${target.type}`, splitCurrency);
  }, [useSplitCurrency, splitCurrency, target.id, target.type]);

  const originalTotalFromItems = editableItems.reduce((sum, item) => sum + item.price, 0);
  const conversionRate = useSplitCurrency && parseFloat(splitTotal) > 0 ? (parseFloat(splitTotal) / originalTotalFromItems) : 1;

  const handleUpdateItemName = (idx: number, newName: string) => {
    const originalName = receipt.items[idx].name;
    setEditableItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], name: newName };
      return next;
    });
    
    setNameMappings(prev => {
      const next = { ...prev, [originalName]: newName };
      localStorage.setItem('receipt_name_mappings', JSON.stringify(next));
      return next;
    });
  };

  const handleUpdateItemPrice = (idx: number, newPrice: string) => {
    const price = parseFloat(newPrice) || 0;
    setEditableItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], price };
      return next;
    });
  };

  const handleTranslate = async (idx: number) => {
    setTranslatingIdx(idx);
    try {
      const translated = await translateText(editableItems[idx].name);
      handleUpdateItemName(idx, translated);
    } catch (error) {
      console.error("Translation error", error);
    } finally {
      setTranslatingIdx(null);
    }
  };

  // Calculate per-member owed shares
  const calculateResult = () => {
    const owedShares: Record<number, number> = {};
    target.members.forEach(m => owedShares[m.id] = 0);

    const currencyToUse = useSplitCurrency ? splitCurrency : formData.currency_code;

    editableItems.forEach((item, idx) => {
      const selectedMemberIds = itemSplits[idx];
      if (selectedMemberIds.length > 0) {
        const itemPriceInSplitCurrency = item.price * conversionRate;
        const sharePerPerson = itemPriceInSplitCurrency / selectedMemberIds.length;
        selectedMemberIds.forEach(uid => {
          owedShares[uid] = (owedShares[uid] || 0) + sharePerPerson;
        });
      }
    });

    const itemTotalInOriginal = originalTotalFromItems;
    
    return { owedShares, itemTotal: itemTotalInOriginal, activeCurrency: currencyToUse };
  };

  const { owedShares, itemTotal, activeCurrency } = calculateResult();

  const toggleMemberForItem = (itemIdx: number, userId: number) => {
    setItemSplits(prev => {
      const current = prev[itemIdx] || [];
      const next = current.includes(userId) 
        ? current.filter(id => id !== userId)
        : [...current, userId];
      return { ...prev, [itemIdx]: next };
    });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const activeItems = editableItems.filter((_, idx) => (itemSplits[idx] || []).length > 0);
      
      if (activeItems.length === 0) {
        throw new Error("No items have been assigned to members.");
      }

      if (useSplitCurrency && (!splitTotal || parseFloat(splitTotal) <= 0)) {
        throw new Error(`Please enter the total amount charged in ${splitCurrency}.`);
      }

      // Handle duplicate names by adding suffixes
      const nameCounts: Record<string, number> = {};
      editableItems.forEach((item, idx) => {
        const n = item.name.trim();
        if ((itemSplits[idx] || []).length > 0) {
          nameCounts[n] = (nameCounts[n] || 0) + 1;
        }
      });

      const currentNames: Record<string, number> = {};
      const itemsToSync: any[] = [];
      
      editableItems.forEach((item, idx) => {
        const members = itemSplits[idx] || [];
        if (members.length === 0) return;
        
        const name = item.name.trim();
        let finalName = name;
        if (nameCounts[name] > 1) {
          const countIdx = (currentNames[name] || 0) + 1;
          currentNames[name] = countIdx;
          finalName = `${name} - ${countIdx}`;
        }
        
        itemsToSync.push({
          name: finalName,
          price: item.price,
          selectedMemberIds: members
        });
      });

      for (let i = 0; i < itemsToSync.length; i++) {
        const item = itemsToSync[i];
        const itemPriceInSplitCurrency = item.price * conversionRate;
        const numSplitters = item.selectedMemberIds.length;
        
        // Use noon UTC to prevent timezone shifts from moving the date back/forward
        const submissionDate = formData.date ? `${formData.date}T12:00:00Z` : new Date().toISOString();

        const payload: any = {
          description: item.name, // Item name is the main expense name (e.g. "Chicken Breast - 1")
          details: formData.description, // Shop name stored in details/notes (e.g. "Pali Aurora")
          cost: itemPriceInSplitCurrency.toFixed(2),
          currency_code: activeCurrency,
          date: submissionDate,
          group_id: target.type === "group" ? target.id : undefined,
        };

        if (target.type === "friend") {
          payload.friend_id = target.id;
        }

        // Calculate shares with rounding adjustment
        let totalOwedAccountedFor = 0;
        const userShares = target.members.map((member, index) => {
          const isSplitter = item.selectedMemberIds.includes(member.id);
          let owed = 0;
          if (isSplitter) {
            // If it's the last splitter, give them the remainder to ensure sum(owed) == cost
            const isLastSplitter = index === target.members.findLastIndex(m => item.selectedMemberIds.includes(m.id));
            if (isLastSplitter) {
              owed = itemPriceInSplitCurrency - totalOwedAccountedFor;
            } else {
              owed = Math.floor((itemPriceInSplitCurrency / numSplitters) * 100) / 100;
              totalOwedAccountedFor += owed;
            }
          }
          
          const paid = (member.id === currentUser.id) ? itemPriceInSplitCurrency : 0;
          
          return {
            user_id: member.id,
            paid: paid.toFixed(2),
            owed: owed.toFixed(2)
          };
        });

        userShares.forEach((share, index) => {
          payload[`users__${index}__user_id`] = share.user_id;
          payload[`users__${index}__paid_share`] = share.paid;
          payload[`users__${index}__owed_share`] = share.owed;
        });

        // Add a small delay between requests to respect rate limits
        if (i > 0) await new Promise(r => setTimeout(r, 500));

        const res = await apiFetch("/api/splitwise/create_expense", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(`Failed splitting "${item.name}": ${errData.errors ? Object.values(errData.errors).flat().join(", ") : "Unknown error"}`);
        }
      }

      onSuccess();
    } catch (error: any) {
      console.error("Submission failed", error);
      alert(error.message || "Error creating expenses. Some items may have been partially added.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      key="review"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-0 z-40 flex flex-col bg-bg-card text-neutral-200"
    >
      <header className="flex items-center justify-between p-6 border-b border-border-card bg-bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <button onClick={onCancel} className="text-sm font-medium text-neutral-500 hover:text-white transition-colors">Cancel</button>
        <div className="text-center">
          <h1 className="text-[10px] uppercase tracking-[0.2em] text-emerald-500 font-bold">SplitSync Pro</h1>
          <h2 className="text-lg font-medium text-white">Itemized Split</h2>
        </div>
        <div className="w-10"></div>
      </header>

       <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-5 mt-4">
        <div className="flex items-center justify-between bg-bg-item p-3 rounded-2xl border border-border-item">
           <div className="flex items-center gap-3">
              <div className="h-12 w-12 overflow-hidden rounded-xl border border-neutral-700 bg-black">
                 <img src={image} className="h-full w-full object-cover" />
              </div>
              <div className="space-y-0.5">
                 <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest">Selected Group</p>
                 <p className="text-base font-bold text-white truncate max-w-[140px]">{target.name}</p>
              </div>
           </div>
           <button 
             onClick={() => setShowTargetSelector(true)}
             className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 hover:bg-emerald-500/20 transition-all shrink-0"
           >
              Switch
           </button>
        </div>

        {/* Target Selector Modal */}
        <AnimatePresence>
          {showTargetSelector && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-sm bg-bg-card border border-border-card rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
              >
                <div className="p-6 border-b border-border-card flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Switch Target</h3>
                  <button onClick={() => setShowTargetSelector(false)} className="p-2 -mr-2 text-neutral-500">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  <p className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest px-2 mb-2">Groups</p>
                  {groups.map(g => (
                    <button
                      key={`switch-g-${g.id}`}
                      onClick={() => {
                        setTarget({ id: g.id, type: "group", name: g.name, members: g.members });
                        setShowTargetSelector(false);
                      }}
                      className={`flex w-full items-center gap-3 p-3 rounded-2xl transition-all ${target.id === g.id && target.type === 'group' ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-neutral-800'}`}
                    >
                      <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-bg-main border border-border-item text-emerald-500">
                        <Users className="h-4 w-4" />
                      </div>
                      <span className="text-sm font-medium text-white truncate">{g.name}</span>
                    </button>
                  ))}
                  
                  <p className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest px-2 mt-4 mb-2">Friends</p>
                  {friends.slice(0, 5).map(f => (
                    <button
                      key={`switch-f-${f.id}`}
                      onClick={() => {
                        const members = [currentUser];
                        if (f.id !== currentUser.id) members.push(f);
                        setTarget({ id: f.id, type: "friend", name: f.first_name, members });
                        setShowTargetSelector(false);
                      }}
                      className={`flex w-full items-center gap-3 p-3 rounded-2xl transition-all ${target.id === f.id && target.type === 'friend' ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-neutral-800'}`}
                    >
                      <div className="h-8 w-8 overflow-hidden rounded-full border border-border-item">
                        {f.picture.small ? <img src={f.picture.small} className="h-full w-full" /> : <div className="h-full w-full flex items-center justify-center bg-bg-main"><UserIcon className="h-4 w-4 text-neutral-500" /></div>}
                      </div>
                      <span className="text-sm font-medium text-white truncate">{f.first_name}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-4">
          <div className="space-y-3">
             <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Merchant Name</label>
                <input 
                   type="text" 
                   value={formData.description}
                   onChange={(e) => setFormData({...formData, description: e.target.value})}
                   className="w-full bg-transparent border-b border-neutral-800 py-1.5 text-lg font-bold text-white focus:border-emerald-500 focus:outline-none transition-colors"
                />
             </div>
             
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                   <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Date (DD/MM/YY)</label>
                   <input 
                     type="text" 
                     placeholder="DD/MM/YY"
                     value={dateInput}
                     onChange={(e) => handleDateChange(e.target.value)}
                     className="w-full bg-transparent border-b border-neutral-800 py-1.5 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none transition-colors font-mono"
                   />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Currency</label>
                  <input 
                    type="text" 
                    placeholder="e.g. USD"
                    maxLength={3}
                    value={formData.currency_code}
                    onChange={(e) => setFormData({...formData, currency_code: e.target.value.toUpperCase()})}
                    className="w-full bg-transparent border-b border-neutral-800 py-1.5 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none transition-colors font-mono"
                  />
                </div>
             </div>

             <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                   <input 
                     type="checkbox" 
                     id="useSplitCurrency"
                     checked={useSplitCurrency}
                     onChange={(e) => setUseSplitCurrency(e.target.checked)}
                     className="rounded border-neutral-700 bg-neutral-800 text-emerald-500 focus:ring-emerald-500/20"
                   />
                   <label htmlFor="useSplitCurrency" className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 cursor-pointer">
                      Split in different currency? (e.g. USD charge)
                   </label>
                </div>

                 {useSplitCurrency && (
                    <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                       <div className="flex flex-col gap-1">
                         <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/70">Split Currency</label>
                         <input 
                           type="text" 
                           placeholder="USD"
                           maxLength={3}
                           value={splitCurrency}
                           onChange={(e) => setSplitCurrency(e.target.value.toUpperCase())}
                           className="w-full bg-transparent border-b border-emerald-500/30 py-1.5 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none transition-colors font-mono"
                         />
                       </div>
                       <div className="flex flex-col gap-1">
                         <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/70">
                           Charged <span className="text-red-500">*</span>
                         </label>
                         <input 
                           type="number" 
                           step="0.01"
                           placeholder="0.00"
                           required={useSplitCurrency}
                           value={splitTotal}
                           onChange={(e) => setSplitTotal(e.target.value)}
                           className="w-full bg-transparent border-b border-emerald-500/30 py-1.5 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none transition-colors font-mono"
                         />
                       </div>
                    </div>
                 )}
              </div>
              
              <div className="flex flex-col gap-1 border-t border-neutral-800 pt-3">
                 <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Receipt Total ({formData.currency_code})</label>
                 <div className="flex items-center gap-2">
                    <p className="py-1 text-xl font-mono font-bold text-emerald-400">{itemTotal.toFixed(2)}</p>
                   {useSplitCurrency && conversionRate !== 1 && (
                      <span className="text-[10px] font-mono text-emerald-500/50 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                         Rate: 1 {formData.currency_code} = {conversionRate.toFixed(6)} {splitCurrency}
                      </span>
                   )}
                </div>
             </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Line Items & Assignments</h4>
            <div className="space-y-3">
               {editableItems.map((item, idx) => (
                 <div key={idx} className="bg-bg-item rounded-2xl p-3 border border-border-item shadow-sm space-y-3">
                    <div className="flex items-start justify-between gap-4">
                       <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2">
                             <input 
                               type="text"
                               value={item.name}
                               onChange={(e) => handleUpdateItemName(idx, e.target.value)}
                               className="bg-transparent text-sm font-bold text-white border-b border-neutral-800 focus:border-emerald-500 focus:outline-none transition-colors w-full py-1"
                             />
                             <button 
                               onClick={() => handleTranslate(idx)}
                               disabled={translatingIdx === idx}
                               title="Translate to English"
                               className="p-1.5 text-neutral-500 hover:text-emerald-500 transition-colors bg-bg-main rounded-lg border border-neutral-800 shrink-0"
                             >
                                {translatingIdx === idx ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
                             </button>
                          </div>
                          <p className="text-[10px] text-neutral-500 font-mono italic">
                            {(item.price * conversionRate).toFixed(2)} {activeCurrency}
                          </p>
                       </div>
                       <div className="flex flex-col items-end gap-1 shrink-0">
                          <div className="flex items-center gap-2 bg-neutral-900 rounded-lg px-2 py-1 border border-neutral-800">
                             <span className="text-[10px] font-mono text-neutral-500">{formData.currency_code}</span>
                             <input 
                               type="number"
                               step="0.01"
                               value={item.price}
                               onChange={(e) => handleUpdateItemPrice(idx, e.target.value)}
                               className="bg-transparent text-sm font-mono font-bold text-neutral-300 w-20 text-right focus:outline-none focus:text-white"
                             />
                          </div>
                       </div>
                    </div>

                    <div className="pt-2 border-t border-neutral-800">
                       <p className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest mb-3">Split Between:</p>
                       <div className="flex flex-wrap gap-2">
                          {target.members.map((member, mIdx) => (
                            <button 
                              key={`${member.id}-assign-${mIdx}`}
                              onClick={() => toggleMemberForItem(idx, member.id)}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold transition-all ${itemSplits[idx]?.includes(member.id) ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' : 'bg-bg-main border-neutral-800 text-neutral-500 hover:border-neutral-700'}`}
                            >
                               <div className="h-4 w-4 overflow-hidden rounded-full bg-neutral-800 border border-neutral-700">
                                  {member.picture.small ? <img src={member.picture.small} className="h-full w-full" /> : <div className="h-full w-full flex items-center justify-center bg-neutral-800"><UserIcon className="h-2 w-2" /></div>}
                               </div>
                               <span>{member.first_name}</span>
                               {itemSplits[idx]?.includes(member.id) && <Check className="h-3 w-3" />}
                            </button>
                          ))}
                       </div>
                    </div>
                 </div>
               ))}
            </div>
          </div>
        </div>

        <section className="bg-bg-item rounded-2xl p-6 border border-border-item space-y-4 shadow-xl">
           <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Summary Distribution</h4>
           <div className="space-y-3">
              {target.members.map((member, idx) => (
                <div key={`${member.id}-summary-${idx}`} className="flex items-center justify-between">
                   <div className="flex items-center gap-3">
                      <div className="h-8 w-8 overflow-hidden rounded-full border border-neutral-800">
                         {member.picture.small ? <img src={member.picture.small} className="h-full w-full" /> : <UserIcon className="h-4 w-4 text-neutral-600" />}
                      </div>
                      <p className="text-sm font-medium text-neutral-300">{member.id === currentUser.id ? 'You' : member.first_name}</p>
                   </div>
                   <p className="text-sm font-mono font-bold text-white">{activeCurrency} {(owedShares[member.id] || 0).toFixed(2)}</p>
                </div>
              ))}
           </div>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-bg-card/90 backdrop-blur-xl border-t border-border-card z-30">
        <button 
          onClick={handleSubmit}
          disabled={isSubmitting || !formData.description}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-neutral-100 py-4 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:opacity-50 hover:bg-white shadow-[0_4px_30px_rgba(255,255,255,0.1)]"
        >
          {isSubmitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
               <span>Sync {(itemTotal * conversionRate).toFixed(2)} {activeCurrency}</span>
               <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

