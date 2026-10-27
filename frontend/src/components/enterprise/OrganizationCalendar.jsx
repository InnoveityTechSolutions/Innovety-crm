import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Filter,
  Building2, Users, Gift, Award, Clock, RefreshCw, X, Sparkles
} from 'lucide-react';
import api from '../../services/api';
import { useCompanyScope } from '../../context/CompanyScopeContext';

const EVENT_TYPE_BADGES = {
  HOLIDAY: { label: 'Public Holiday', bg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  LEAVE: { label: 'Approved Leave', bg: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  SHIFT_OVERRIDE: { label: 'Shift Override', bg: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
  BIRTHDAY: { label: 'Birthday', bg: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300' },
  WORK_ANNIVERSARY: { label: 'Work Anniversary', bg: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300' },
  COMPANY_EVENT: { label: 'Company Event', bg: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' },
  COMP_OFF: { label: 'Comp-Off Work', bg: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' }
};

const OrganizationCalendar = () => {
  const { selectedOrgId } = useCompanyScope();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'agenda'

  // Create Event Modal
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    eventType: 'TOWN_HALL',
    startDate: '',
    endDate: '',
    location: '',
    branchId: ''
  });

  const fetchCalendar = async () => {
    setLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const startDate = new Date(year, month, 1).toISOString();
      const endDate = new Date(year, month + 1, 0).toISOString();

      const [calRes, bRes] = await Promise.all([
        api.get('/enterprise/calendar', {
          params: {
            startDate,
            endDate,
            branchId: selectedBranch,
            department: selectedDept
          }
        }),
        api.get('/enterprise/branches')
      ]);

      if (calRes.data?.success) setEvents(calRes.data.events || []);
      if (bRes.data?.success) setBranches(bRes.data.branches || []);
    } catch (err) {
      console.error('Failed to fetch calendar:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendar();
  }, [selectedOrgId, currentDate, selectedBranch, selectedDept]);

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/enterprise/calendar/events', eventForm);
      if (res.data?.success) {
        setEventModalOpen(false);
        setEventForm({ title: '', description: '', eventType: 'TOWN_HALL', startDate: '', endDate: '', location: '', branchId: '' });
        fetchCalendar();
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to create company event.');
    } finally {
      setSubmitting(false);
    }
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const todayMonth = () => {
    setCurrentDate(new Date());
  };

  // Generate calendar days matrix
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
            <CalendarIcon className="w-7 h-7 text-emerald-500" />
            Unified Organization Calendar
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Single operational timeline uniting Public Holidays, Approved Leaves, Shift Transitions, Birthdays, and Events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEventModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm shadow-md shadow-emerald-500/20"
          >
            <Plus className="w-4 h-4" />
            Schedule Company Event
          </button>
        </div>
      </div>

      {/* Control Bar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">
            <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </button>
          <span className="font-bold text-base text-slate-800 dark:text-slate-100 min-w-44 text-center">
            {monthName}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">
            <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </button>
          <button onClick={todayMonth} className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold hover:bg-slate-200">
            Today
          </button>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto text-xs">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border text-slate-700 dark:text-slate-200"
          >
            <option value="ALL">All Branches</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </select>

          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${viewMode === 'calendar' ? 'bg-white dark:bg-slate-900 text-slate-800 shadow-xs' : 'text-slate-500'}`}
            >
              Month Grid
            </button>
            <button
              onClick={() => setViewMode('agenda')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${viewMode === 'agenda' ? 'bg-white dark:bg-slate-900 text-slate-800 shadow-xs' : 'text-slate-500'}`}
            >
              Agenda ({events.length})
            </button>
          </div>
        </div>
      </div>

      {/* View: Month Grid */}
      {viewMode === 'calendar' ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-800/60 border-b text-center text-xs font-bold text-slate-500 uppercase py-3">
            <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {/* Blank offset days */}
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`blank-${i}`} className="min-h-24 bg-slate-50/40 dark:bg-slate-900/30 p-2" />
            ))}

            {/* Calendar days */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const dayEvents = events.filter((e) => {
                const eStart = new Date(e.startDate).toISOString().slice(0, 10);
                const eEnd = new Date(e.endDate).toISOString().slice(0, 10);
                return dateStr >= eStart && dateStr <= eEnd;
              });

              const isToday = new Date().toISOString().slice(0, 10) === dateStr;

              return (
                <div key={`day-${dayNum}`} className={`min-h-24 p-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30 ${isToday ? 'bg-emerald-50/20' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold ${isToday ? 'w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center' : 'text-slate-700 dark:text-slate-200'}`}>
                      {dayNum}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-slate-400 font-mono">{dayEvents.length}</span>
                    )}
                  </div>

                  <div className="space-y-1 overflow-y-auto max-h-20 pr-0.5">
                    {dayEvents.map((e, idx) => (
                      <div
                        key={idx}
                        className="px-1.5 py-0.5 rounded text-[10px] truncate font-medium text-white shadow-xs"
                        style={{ backgroundColor: e.color || '#6366F1' }}
                        title={`${e.title} - ${e.description}`}
                      >
                        {e.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* View: Agenda List */
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
          <h3 className="font-bold text-base text-slate-800 dark:text-slate-100 mb-2">Upcoming Events in {monthName}</h3>
          {events.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No scheduled events or leaves found for this month.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {events.map((e, idx) => {
                const badge = EVENT_TYPE_BADGES[e.type] || { label: e.type, bg: 'bg-slate-100 text-slate-700' };
                return (
                  <div key={idx} className="py-3 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg}`}>
                          {badge.label}
                        </span>
                        <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">{e.title}</h4>
                      </div>
                      <p className="text-slate-500">{e.description}</p>
                      {e.location && <p className="text-slate-400 text-[11px]">Location: {e.location}</p>}
                    </div>

                    <div className="text-right text-slate-500 whitespace-nowrap">
                      <p className="font-semibold">{new Date(e.startDate).toLocaleDateString()}</p>
                      {e.startDate !== e.endDate && (
                        <p className="text-[11px] text-slate-400">until {new Date(e.endDate).toLocaleDateString()}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Schedule Event Modal */}
      <AnimatePresence>
        {eventModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border p-6 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b">
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-100">Schedule Company Event</h3>
                <button onClick={() => setEventModalOpen(false)}><X className="w-4 h-4 text-slate-400" /></button>
              </div>

              <form onSubmit={handleCreateEvent} className="space-y-3 mt-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Event Title *</label>
                  <input type="text" required placeholder="e.g. Q4 Platform All-Hands" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Event Category</label>
                    <select value={eventForm.eventType} onChange={(e) => setEventForm({ ...eventForm, eventType: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800">
                      <option value="TOWN_HALL">Town Hall</option>
                      <option value="ALL_HANDS">All Hands</option>
                      <option value="TRAINING">Workshop / Training</option>
                      <option value="CELEBRATION">Celebration</option>
                      <option value="DEADLINE">Release Deadline</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Branch</label>
                    <select value={eventForm.branchId} onChange={(e) => setEventForm({ ...eventForm, branchId: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800">
                      <option value="">All Branches</option>
                      {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Start Date *</label>
                    <input type="date" required value={eventForm.startDate} onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800" />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">End Date</label>
                    <input type="date" value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800" />
                  </div>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Location / Meeting URL</label>
                  <input type="text" placeholder="e.g. Hyderabad Auditorium / Zoom Link" value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} className="w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-800" />
                </div>
                <div className="pt-3 flex justify-end gap-2 border-t">
                  <button type="button" onClick={() => setEventModalOpen(false)} className="px-4 py-2 rounded-xl text-slate-500">Cancel</button>
                  <button type="submit" disabled={submitting} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium">Publish Event</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OrganizationCalendar;
