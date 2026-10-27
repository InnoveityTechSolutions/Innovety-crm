import React, { useState, useEffect } from 'react';
import {
  X, Users, UserPlus, Search, Shield, Building2, CheckCircle,
  AlertCircle, RefreshCw, Mail, Phone, Calendar, UserX
} from 'lucide-react';
import api from '../../../services/api';
import UserAvatar from '../../../components/common/UserAvatar';

const TemplateMembersDrawer = ({
  isOpen,
  onClose,
  template,
  onRegisterNew
}) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchMembers = async () => {
    if (!template?.id) return;
    try {
      setLoading(true);
      setErrorMessage('');
      const res = await api.get(`/super-admin/access-templates/${template.id}/members`);
      if (res.data?.success) {
        setMembers(res.data.members || []);
      }
    } catch (err) {
      console.error('Failed to load template members:', err);
      setErrorMessage('Failed to load assigned members.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && template?.id) {
      fetchMembers();
      setSearchTerm('');
    }
  }, [isOpen, template]);

  if (!isOpen || !template) return null;

  const filteredMembers = members.filter((m) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.email && m.email.toLowerCase().includes(q)) ||
      (m.employeeId && m.employeeId.toLowerCase().includes(q)) ||
      (m.department && m.department.toLowerCase().includes(q))
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-xl h-full bg-card border-l border-border/80 shadow-2xl flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-5 border-b border-border/60 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-tight text-foreground">
                  Assigned Members
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary font-black text-[10px]">
                  {members.length} Total
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-medium truncate max-w-sm">
                Template: <strong className="text-foreground">{template.name}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchMembers}
              title="Refresh Members"
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Drawer Context & Search Banner */}
        <div className="p-4 border-b border-border/60 bg-muted/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 text-primary" />
              <span>Org: <strong className="text-foreground">{template.organization?.name || 'Assigned Org'}</strong></span>
              <span>•</span>
              <Shield className="h-3.5 w-3.5 text-primary" />
              <span>Base Role: <strong className="text-foreground">{template.baseRole}</strong></span>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                if (onRegisterNew) onRegisterNew(template);
              }}
              className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-black shadow-sm flex items-center gap-1.5 transition"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Register User
            </button>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search assigned members by name, email, or employee ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 text-xs font-medium rounded-xl border border-border/60 bg-background focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
        </div>

        {/* Drawer Members List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2.5 text-xs font-bold">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center text-muted-foreground space-y-2">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto text-primary" />
              <p className="text-xs font-bold">Loading assigned members...</p>
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="p-10 text-center border border-dashed border-border/80 rounded-2xl text-muted-foreground space-y-3">
              <Users className="h-8 w-8 mx-auto opacity-40" />
              <div className="space-y-1">
                <p className="text-xs font-black text-foreground">
                  {searchTerm ? 'No members match your search' : 'No users currently assigned to this template'}
                </p>
                <p className="text-[11px]">
                  {searchTerm
                    ? 'Try adjusting your search criteria.'
                    : 'Register a new user or assign existing accounts to inherit these permissions.'}
                </p>
              </div>
              {!searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (onRegisterNew) onRegisterNew(template);
                  }}
                  className="px-4 py-2 rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-black hover:bg-primary/20 transition inline-flex items-center gap-1.5"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Register First Member
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className="p-3.5 rounded-2xl bg-background border border-border/60 hover:border-border shadow-xs flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar user={member} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-foreground truncate">
                          {member.name}
                        </span>
                        {member.employeeId && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono font-bold">
                            {member.employeeId}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground truncate">
                        <span>{member.email}</span>
                        {member.phone && (
                          <>
                            <span>•</span>
                            <span>{member.phone}</span>
                          </>
                        )}
                      </div>
                      {(member.department || member.designation) && (
                        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                          {[member.designation, member.department].filter(Boolean).join(' • ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${
                        member.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : 'bg-muted text-muted-foreground border-border'
                      }`}
                    >
                      {member.status}
                    </span>
                    {member.joiningDate && (
                      <span className="text-[10px] text-muted-foreground">
                        Joined {new Date(member.joiningDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-border/60 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {filteredMembers.length} of {members.length} members</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-card border border-border/60 hover:bg-muted text-foreground font-bold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateMembersDrawer;
