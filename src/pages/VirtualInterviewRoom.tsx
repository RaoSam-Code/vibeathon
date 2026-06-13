/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Mic,
  MicOff,
  PhoneOff,
  Video,
  VideoOff,
  Settings,
  X,
  Loader2,
  Subtitles,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { API_URL } from "@/lib/api";
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
} from "@heygen/streaming-avatar";
import InterviewAvatar from "@/components/InterviewAvatar";

interface Persona {
  name: string;
  desc: string;
  id: string;
  avatarUrl: string; // URL for stock video
  heygenAvatarId?: string; // The 3D Avatar Face ID
  voiceParams: { pitch: number; rate: number; voiceURI?: string };
}

export default function VirtualInterviewRoom() {
  const location = useLocation();
  const navigate = useNavigate();
  // Expecting selectedPersonas to be passed via router state
  const selectedPersonas: Persona[] = location.state?.selectedPersonas || [];
  const roleContext = location.state?.role || "Software Engineer";
  const companyContext = location.state?.company || "Tech Company";
  
  const [startTime] = useState<number>(Date.now());

  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [camActive, setCamActive] = useState(true);

  // Chat History & Speech
  const [history, setHistory] = useState<{ role: string; content: string }[]>(
    [],
  );
  const [transcript, setTranscript] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [failedPersonas, setFailedPersonas] = useState<Record<string, boolean>>(
    { /* empty */ },
  );

  // AI Recruiter Coach Evaluation States
  const [latestEval, setLatestEval] = useState<{
    score_content: number;
    score_delivery: number;
    feedback: string;
    tone: string;
    star_status: { situation: boolean; task: boolean; action: boolean; result: boolean };
    strength?: string;
    weakness?: string;
    keyword_score?: number;
    pacing_score?: number;
    filler_words_score?: number;
  } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationsList, setEvaluationsList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"coach" | "report">("coach");

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [selectedCam, setSelectedCam] = useState<string>("");
  const [aiSpeed, setAiSpeed] = useState<number>(1.0);

  // Captions & Silence Threshold settings
  const [showCaptions, setShowCaptions] = useState(true);
  const [pauseThreshold, setPauseThreshold] = useState<number>(3.0);
  const [silenceProgress, setSilenceProgress] = useState<number>(100);
  const lastSpeechTimeRef = useRef<number>(Date.now());

  const recognitionRef = useRef<any>(null);
  const panelBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [history.length, latestEval, activeTab]);

  // HeyGen Clients map: { personaId: StreamingAvatar }
  const heygenClientsRef = useRef<Record<string, StreamingAvatar>>({ /* empty */ });
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({ /* empty */ });

  // Fallback if no personas selected
  useEffect(() => {
    if (selectedPersonas.length === 0) {
      navigate("/dashboard");
    }
  }, [selectedPersonas, navigate]);

  // Initialize HeyGen Clients for each persona
  useEffect(() => {
    if (selectedPersonas.length === 0) return;

    let isMounted = true;
    const clientsToCleanUp: StreamingAvatar[] = [];

    const initClients = async () => {
      try {
        // Fetch token securely from backend
        const tokenRes = await fetch(`${API_URL}api/heygen-token`, {
          method: "POST",
        });
        if (!tokenRes.ok) throw new Error("Failed to get HeyGen token");
        const { token } = await tokenRes.json();

        for (const persona of selectedPersonas) {
          if (!isMounted) break;

          try {
            const avatar = new StreamingAvatar({ token });
            clientsToCleanUp.push(avatar);

            // Handle Video Stream
            avatar.on(StreamingEvents.STREAM_READY, (event: any  ) => {
              console.log(`HeyGen Stream ready for ${persona.name}`);
              if (videoRefs.current[persona.id] && event.detail) {
                videoRefs.current[persona.id]!.srcObject = event.detail;
              }
            });

            // Handle UI States seamlessly
            avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
              if (isMounted) {
                setActiveSpeakerId(persona.id);
                setIsAiThinking(false);
                setMicActive(false);
              }
            });

            avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
              if (isMounted) {
                setActiveSpeakerId(null);
                setMicActive(true);
              }
            });

            // Start the Streaming WebRTC connection
            await avatar.createStartAvatar({
              quality: AvatarQuality.Low,
              avatarName:
                persona.heygenAvatarId || "99160ec3aef04ddab034f4a306665d00",
            });

            if (isMounted) {
              heygenClientsRef.current[persona.id] = avatar;
            }
          } catch (personaErr: unknown) {
            console.warn(
              `HeyGen init skipped for ${persona.name} (Likely limits):`,
              personaErr.message || personaErr,
            );
            if (isMounted)
              setFailedPersonas((prev) => ({ ...prev, [persona.id]: true }));
          }
        }
      } catch (err) {
        console.error("Initialization error:", err);
        if (isMounted) {
          const failures: Record<string, boolean> = {};
          selectedPersonas.forEach((p) => {
            failures[p.id] = true;
          });
          setFailedPersonas(failures);
        }
      }
    };

    initClients();

    return () => {
      isMounted = false;
      // Cleanup all instantiated clients to prevent leaks
      clientsToCleanUp.forEach((client) => {
        try {
          client.stopAvatar();
        } catch (e) { /* empty */ }
      });
      heygenClientsRef.current = { /* empty */ };
    };
  }, [selectedPersonas]);

  // Initialize Speech Recognition
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window)) return;
    const SpeechRecognition = (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any  ) => {
      let fullTranscript = "";
      for (let i = 0; i < event.results.length; ++i) {
        fullTranscript += event.results[i][0].transcript;
      }
      setTranscript(fullTranscript);
      lastSpeechTimeRef.current = Date.now();
      setSilenceProgress(100);
    };

    recognition.onend = () => {
      // If the session hasn't been deliberately paused by the AI thinking/talking, auto-restart
      if (micActive && !activeSpeakerId && !isAiThinking) {
        try {
          recognition.start();
        } catch (e) { /* empty */ }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, []); // Only run once to initialize

  // Toggle Mic based on state changes
  useEffect(() => {
    if (!recognitionRef.current) return;
    
    // If AI is not thinking and no one is speaking, turn mic ON
    if (micActive && !activeSpeakerId && !isAiThinking) {
      try {
        recognitionRef.current.start();
      } catch (e) { 
        // Already started error is safe to ignore
      }
    } 
    // If AI is thinking or speaking, turn mic OFF
    else {
      try { 
        recognitionRef.current.stop(); 
      } catch (e) { /* empty */ }
    }
  }, [micActive, activeSpeakerId, isAiThinking]);

  // Track silence countdown and auto-submit
  useEffect(() => {
    if (!micActive || isAiThinking || activeSpeakerId || !transcript.trim()) {
      setSilenceProgress(100);
      return;
    }

    lastSpeechTimeRef.current = Date.now();
    setSilenceProgress(100);

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastSpeechTimeRef.current;
      const thresholdMs = pauseThreshold * 1000;
      
      if (elapsed >= thresholdMs) {
        clearInterval(interval);
        setSilenceProgress(0);
        submitUserResponse();
      } else {
        const remainingPct = Math.max(0, 100 - (elapsed / thresholdMs) * 100);
        setSilenceProgress(remainingPct);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [transcript, micActive, isAiThinking, activeSpeakerId, pauseThreshold]);

  // The Core AI Conversation Loop
  const submitUserResponse = async () => {
    if (!transcript.trim()) return;

    const userMessage = transcript.trim();
    setTranscript("");
    setHistory((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsAiThinking(true);
    setMicActive(false); // Pause mic while AI thinks/speaks

    // Trigger AI Recruiter Coach Live Evaluation
    const lastQuestionObj = [...history].reverse().find(h => h.role === 'ai');
    const questionText = lastQuestionObj ? lastQuestionObj.content : "Introduce yourself and explain why you're a good fit.";

    setIsEvaluating(true);
    fetch(`${API_URL}api/agents/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: questionText, answer: userMessage }),
    })
      .then((r) => r.json())
      .then((evalData) => {
        setLatestEval(evalData);
        setEvaluationsList((prev) => [...prev, evalData]);
        setIsEvaluating(false);
      })
      .catch((err) => {
        console.error("Live evaluation failed:", err);
        setIsEvaluating(false);
      });

    try {
      const res = await fetch(`${API_URL}api/agents/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history,
          personas: selectedPersonas, // Pass the panel array
        }),
      });

      const data = await res.json();

      const aiResponse = data.content;
      const speakerName = data.speaker; // The LLM specifies who is speaking

      setHistory((prev) => [...prev, { role: "ai", content: aiResponse }]);

      // Find which avatar matches the speaker name
      const speakingAvatar =
        selectedPersonas.find((p) => p.name === speakerName) ||
        selectedPersonas[0];

      await speakAiResponse(aiResponse, speakingAvatar);
    } catch (err) {
      console.error("AI chat error:", err);
      setIsAiThinking(false);
      setMicActive(true);
    }
  };

  // Trigger HeyGen natively
  const speakAiResponse = async (text: string, avatar: Persona) => {
    setIsAiThinking(true);

    try {
      const client = heygenClientsRef.current[avatar.id];
      if (client) {
        // Triggers the HeyGen Cloud TTS, which eventually fires AVATAR_START_TALKING
        await client.speak({ text, taskType: TaskType.TALK });
      } else {
        // Fallback: If limits hit, emulate the timing using native Web Speech Synthesis
        setActiveSpeakerId(avatar.id);

        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.pitch = avatar.voiceParams.pitch || 1;
          utterance.rate = avatar.voiceParams.rate || 1;

          utterance.onend = () => {
            setActiveSpeakerId(null);
            setIsAiThinking(false);
            setMicActive(true);
          };

          window.speechSynthesis.speak(utterance);
        } else {
          // Emulate the timing if limits hit
          setActiveSpeakerId(avatar.id);
          setIsAiThinking(false);
          setMicActive(false);

          setTimeout(() => {
            setActiveSpeakerId(null);
            setIsAiThinking(false);
            setMicActive(true);
          }, text.length * 60); // Roughly 60ms per character
        }
      }
    } catch (e) {
      console.error("HeyGen speak failed", e);
      // Fallback
      setIsAiThinking(false);
      setMicActive(true);
    }
  };

  // Start interview automatically by sending an empty string or standard "Hello" to boot
  useEffect(() => {
    if (selectedPersonas.length > 0 && history.length === 0 && !isAiThinking) {
      setIsAiThinking(true);
      fetch(`${API_URL}api/agents/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "The candidate has just entered the virtual room. Introduce yourselves quickly and ask the first behavioral question.",
          history: [],
          personas: selectedPersonas,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          setHistory([{ role: "ai", content: data.content }]);
          const avatar =
            selectedPersonas.find((p) => p.name === data.speaker) ||
            selectedPersonas[0];
          speakAiResponse(data.content, avatar);
        })
        .catch((err) => {
          console.error("Failed to start", err);
          setIsAiThinking(false);
        });
    }
     
  }, []);

  // Fetch Devices for Settings
  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((deviceInfos) => {
        setDevices(deviceInfos);
        const audioInputs = deviceInfos.filter((d) => d.kind === "audioinput");
        const videoInputs = deviceInfos.filter((d) => d.kind === "videoinput");
        if (audioInputs.length > 0 && !selectedMic)
          setSelectedMic(audioInputs[0].deviceId);
        if (videoInputs.length > 0 && !selectedCam)
          setSelectedCam(videoInputs[0].deviceId);
      });
    }
  }, []);

  // Helper to aggregate evaluations in real-time
  const aggregateReport = (evals: any[], hist: any[], role: string, company: string) => {
    if (evals.length === 0) {
      return {
        overall_score: 0,
        scores: {
          content_quality: 0,
          communication: 0,
          technical_depth: 0,
          structure: 0,
          confidence: 0
        },
        strengths: [],
        weaknesses: [],
        standout_answers: [],
        weak_answers: [],
        overall_feedback: "No questions were answered during this session. End session triggered early.",
        improvement_roadmap: [],
        metrics: {
          keyword_usage_score: 0,
          keyword_usage_remark: "No Data",
          structure_score: 0,
          structure_remark: "No Data",
          pacing_score: 0,
          pacing_remark: "No Data",
          filler_words_score: 0,
          filler_words_remark: "No Data",
          eye_contact_score: 0,
          eye_contact_remark: "No Data",
          posture_score: 0,
          posture_remark: "No Data",
          content_bullets: [],
          delivery_bullets: [],
          non_verbal_bullets: []
        }
      };
    }

    const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    const contentScores = evals.map(e => e.score_content !== undefined ? e.score_content : (e.vocabularyScore ?? 75));
    const deliveryScores = evals.map(e => e.score_delivery !== undefined ? e.score_delivery : (e.toneScore ?? 75));
    const keywordScores = evals.map(e => e.keyword_score !== undefined ? e.keyword_score : (e.vocabularyScore ?? 75));
    const pacingScores = evals.map(e => e.pacing_score !== undefined ? e.pacing_score : (e.pacingScore ?? 75));
    const fillerScores = evals.map(e => e.filler_words_score !== undefined ? e.filler_words_score : (e.fillerWordsScore ?? 75));

    const contentAvg = avg(contentScores);
    const deliveryAvg = avg(deliveryScores);
    const keywordAvg = avg(keywordScores);
    const pacingAvg = avg(pacingScores);
    const fillerAvg = avg(fillerScores);

    const starRates: number[] = evals.map(e => {
      const star = e.star_status || e.starStatus || { situation: true, task: true, action: false, result: false };
      const count = (star.situation ? 1 : 0) + (star.task ? 1 : 0) + (star.action ? 1 : 0) + (star.result ? 1 : 0);
      return (count / 4) * 100;
    });
    const starAvg = avg(starRates);

    const overallScore = Math.round((contentAvg + deliveryAvg) / 2);

    const strengths = evals.map(e => e.strength).filter(Boolean);
    const weaknesses = evals.map(e => e.weakness).filter(Boolean);

    const standoutAnswers: string[] = [];
    const weakAnswers: string[] = [];

    const qaPairs: { q: string; a: string }[] = [];
    for (let i = 0; i < hist.length; i++) {
      if (hist[i].role === 'ai') {
        const next = hist[i + 1];
        if (next && next.role === 'user') {
          qaPairs.push({ q: hist[i].content, a: next.content });
        }
      }
    }

    evals.forEach((ev, i) => {
      const pair = qaPairs[i];
      if (!pair) return;
      const score = Math.round(((ev.score_content ?? ev.vocabularyScore ?? 75) + (ev.score_delivery ?? ev.toneScore ?? 75)) / 2);
      if (score >= 82) {
        standoutAnswers.push(`Q: "${pair.q}" - Clear structured answer with strong depth (${score}%).`);
      } else if (score < 68) {
        weakAnswers.push(`Q: "${pair.q}" - Could be optimized. ${ev.feedback || ev.weakness}`);
      }
    });

    const roadmap = [
      starAvg < 80 ? "Practice structuring behavioral answers using the complete STAR framework." : "Maintain STAR structure but elaborate on specific technical metrics.",
      keywordAvg < 80 ? "Incorporate more industry-specific technical terminologies and keywords." : "Keep using high-impact keywords to demonstrate expertise.",
      fillerAvg < 80 ? "Minimize the use of vocal fillers (like 'um', 'uh', 'like') by pausing before speaking." : "Excellent pacing; keep monitoring pauses and voice modulation."
    ];

    return {
      overall_score: overallScore,
      scores: {
        content_quality: contentAvg,
        communication: deliveryAvg,
        technical_depth: Math.max(0, Math.min(100, contentAvg - 2)),
        structure: starAvg,
        confidence: Math.max(0, Math.min(100, deliveryAvg + 2))
      },
      strengths: strengths.slice(0, 3),
      weaknesses: weaknesses.slice(0, 3),
      standout_answers: standoutAnswers,
      weak_answers: weakAnswers,
      overall_feedback: `You completed a ${hist.length}-turn interview for ${role} at ${company}. Your content score was ${contentAvg}% with a delivery of ${deliveryAvg}%. ${
        overallScore >= 80 
          ? "Excellent job overall. You demonstrated professional depth, solid articulation, and highly relevant skills." 
          : "Good progress. With a few structural tweaks (like focusing on STAR result metrics) and vocabulary refinement, you will stand out even more."
      }`,
      improvement_roadmap: roadmap,
      metrics: {
        keyword_usage_score: keywordAvg,
        keyword_usage_remark: keywordAvg >= 85 ? "Excellent" : keywordAvg >= 70 ? "Good" : "Needs Work",
        structure_score: starAvg,
        structure_remark: starAvg >= 80 ? "Strong" : starAvg >= 60 ? "Developing" : "Needs Work",
        pacing_score: pacingAvg,
        pacing_remark: pacingAvg >= 80 ? "Ideal" : "Varies",
        filler_words_score: fillerAvg,
        filler_words_remark: fillerAvg >= 80 ? "None/Few" : fillerAvg >= 60 ? "Moderate" : "Frequent",
        eye_contact_score: 95,
        eye_contact_remark: "Strong",
        posture_score: 90,
        posture_remark: "Good",
        content_bullets: strengths.map(s => `Good: ${s}`),
        delivery_bullets: [`Average pacing score: ${pacingAvg}`, fillerAvg < 70 ? "Watch out for vocal filler habits." : "Solid articulation and steady flow."],
        non_verbal_bullets: ["Eye contact stable on camera.", "Posture aligned professionally."]
      }
    };
  };

  const handleEndInterview = () => {
    Object.values(heygenClientsRef.current).forEach((c) => {
      try {
        c.stopAvatar();
      } catch (e) { /* empty */ }
    });
    heygenClientsRef.current = { /* empty */ };
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) { /* empty */ }
    }

    // Save history to localStorage and go to report
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    localStorage.setItem("lastInterviewSession", JSON.stringify(history));
    
    const finalReport = aggregateReport(evaluationsList, history, roleContext, companyContext);

    navigate("/report", { 
      state: { 
        sessionData: history,
        role: roleContext,
        company: companyContext,
        durationSeconds: durationSeconds,
        generatedReport: finalReport
      } 
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white overflow-hidden relative font-sans">
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px]" />
      </div>

      {/* Main Content split layout */}
      <div className="relative z-10 h-screen flex p-6 gap-6 overflow-hidden">
        {/* Left Column: Avatars & Controls */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <header className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full backdrop-blur-md border border-white/10">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-semibold tracking-wider">REC</span>
              <span className="text-xs text-slate-400 ml-2">Panel Session</span>
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              <Settings className="w-5 h-5 text-slate-300" />
            </button>
          </header>

          {/* Avatars Grid */}
          <div
            className={`flex-1 grid gap-6 mb-6 ${
              selectedPersonas.length === 1 ? "grid-cols-1" : "grid-cols-2"
            }`}
          >
            {selectedPersonas.map((persona) => (
              <motion.div
                key={persona.id}
                className={`relative rounded-3xl overflow-hidden bg-slate-800 border-2 transition-colors duration-500 ${
                  activeSpeakerId === persona.id
                    ? "border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)]"
                    : "border-slate-700/50"
                }`}
                layout
              >
                {/* 3D Interview Avatar View */}
                <div className="absolute inset-0 z-10 w-full h-full">
                  <InterviewAvatar
                    modelPath={
                      persona.name === "The Executive"
                        ? "/models/the-executive.glb"
                        : persona.name === "The Architect"
                        ? "/models/the-architect.glb"
                        : "/models/the-debugger.glb"
                    }
                  />
                </div>

                {/* HeyGen WebRTC Video stream */}
                {!failedPersonas[persona.id] && (
                  <video
                    ref={(el) => {
                      videoRefs.current[persona.id] = el;
                    }}
                    autoPlay
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover z-20"
                  />
                )}



                {/* Speaker Overlay */}
                <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-black/50 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 z-30">
                  <div className="flex items-end gap-1 h-4">
                    {[1, 2, 3].map((bar) => (
                      <motion.div
                        key={bar}
                        className={`w-1 bg-blue-400 rounded-full ${
                          activeSpeakerId === persona.id ? "" : "h-1"
                        }`}
                        animate={
                          activeSpeakerId === persona.id
                            ? {
                                height: ["20%", "80%", "40%", "100%", "30%"],
                              }
                            : { height: "20%" }
                        }
                        transition={{
                          repeat: Infinity,
                          duration: 0.8,
                          delay: bar * 0.1,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white leading-tight">
                      {persona.name}
                    </h3>
                    <p className="text-[10px] text-slate-300 font-semibold">
                      {persona.desc}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* User Self-View & Controls */}
          <div className="h-24 flex items-center justify-between px-8 bg-slate-800/50 backdrop-blur-xl border border-white/10 rounded-3xl w-full">
            {/* Mock Self View */}
            <div className="h-16 w-24 bg-slate-700 rounded-xl overflow-hidden relative border border-white/10">
              {camActive ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-800 text-slate-500 text-xs font-bold">
                  Cam On
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                  <VideoOff className="w-5 h-5 text-slate-500" />
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => setMicActive(!micActive)}
                  className={`p-4 rounded-full transition-all ${
                    micActive
                      ? "bg-white/10 text-white hover:bg-white/20"
                      : "bg-red-500/20 text-red-500 hover:bg-red-500/30"
                  } disabled:opacity-50`}
                  disabled={activeSpeakerId !== null || isAiThinking}
                >
                  {micActive ? (
                    <Mic className="w-6 h-6" />
                  ) : (
                    <MicOff className="w-6 h-6" />
                  )}
                </button>
              </div>

              <button
                onClick={() => setCamActive(!camActive)}
                className={`p-4 rounded-full transition-all ${
                  camActive
                    ? "bg-white/10 text-white hover:bg-white/20"
                    : "bg-red-500/20 text-red-500 hover:bg-red-500/30"
                }`}
              >
                {camActive ? (
                  <Video className="w-6 h-6" />
                ) : (
                  <VideoOff className="w-6 h-6" />
                )}
              </button>

              <button
                onClick={() => setShowCaptions(!showCaptions)}
                className={`p-4 rounded-full transition-all ${
                  showCaptions
                    ? "bg-white/10 text-white hover:bg-white/20"
                    : "bg-slate-700/50 text-slate-400 hover:bg-slate-700/80"
                }`}
                title={showCaptions ? "Disable Captions" : "Enable Captions"}
              >
                <Subtitles className="w-6 h-6" />
              </button>

              {/* Answer completion trigger */}
              {transcript && micActive && (
                <button
                  onClick={submitUserResponse}
                  className="px-5 py-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white font-bold ml-2 shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all animate-in zoom-in"
                >
                  Submit Answer
                </button>
              )}

              <button
                onClick={handleEndInterview}
                className="px-6 py-4 rounded-full bg-red-500 hover:bg-red-600 text-white font-bold flex items-center gap-2 transition-colors ml-4 shadow-[0_0_20px_rgba(239,68,68,0.4)]"
              >
                <PhoneOff className="w-5 h-5" /> End Interview
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: AI Recruiter Coach Panel */}
        <div className="w-96 rounded-3xl bg-slate-950/40 backdrop-blur-xl border border-white/10 p-6 flex flex-col gap-6 h-full overflow-y-auto scroll-smooth scrollbar-hide">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="font-display text-sm font-black text-white uppercase tracking-wider">AI Recruiter Coach</h3>
            </div>
            <span className="text-[9px] font-black text-slate-400 bg-white/5 px-2.5 py-1 rounded border border-white/10">Active Evaluation</span>
          </div>

          {/* Tab Selection */}
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setActiveTab("coach")}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                activeTab === "coach"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Live Coach
            </button>
            <button
              onClick={() => setActiveTab("report")}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                activeTab === "report"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Real-Time Report
            </button>
          </div>

          {activeTab === "coach" ? (
            <>
              {isEvaluating && (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-sm font-bold text-slate-300 animate-pulse">Analyzing response structure...</p>
                  <p className="text-[10px] text-slate-500 leading-normal max-w-[200px] mx-auto">Evaluating content quality, tone patterns, and STAR format checklist items.</p>
                </div>
              )}

              {!isEvaluating && !latestEval && (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-4 text-slate-500">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-inner">
                    <Mic className="w-6 h-6 text-slate-400 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-300 mb-1">Coach Standby</h4>
                    <p className="text-xs text-slate-500 max-w-[220px] mx-auto leading-relaxed">
                      Start answering the interviewer's question. Once you finish speaking and submit, the coach will display real-time feedback, tone, and STAR checklist ratings here.
                    </p>
                  </div>
                </div>
              )}

              {!isEvaluating && latestEval && (
                <div className="space-y-6 flex-1 flex flex-col justify-start">
                  {/* Score Meters */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Content Quality</span>
                      <div className="text-3xl font-black text-blue-400">{latestEval.score_content}</div>
                      <span className="text-[10px] text-slate-500 mt-1">/ 100</span>
                    </div>
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Delivery & Clarity</span>
                      <div className="text-3xl font-black text-purple-400">{latestEval.score_delivery}</div>
                      <span className="text-[10px] text-slate-500 mt-1">/ 100</span>
                    </div>
                  </div>

                  {/* Detected Tone */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Answer Tone</label>
                    <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-white flex items-center justify-between shadow-inner">
                      <span>{latestEval.tone || "Analyzing..."}</span>
                      <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                    </div>
                  </div>

                  {/* STAR compliance checklist */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">STAR Structure Check</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "situation", label: "Situation" },
                        { key: "task", label: "Task" },
                        { key: "action", label: "Action" },
                        { key: "result", label: "Result" }
                      ].map((item) => {
                        const hasPart = latestEval.star_status?.[item.key as keyof typeof latestEval.star_status] ?? false;
                        return (
                          <div
                            key={item.key}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-extrabold transition-all duration-300 ${
                              hasPart
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 shadow-[0_2px_8px_rgba(16,185,129,0.1)]"
                                : "bg-white/5 border-white/5 text-slate-500"
                            }`}
                          >
                            <div className={`h-1.5 w-1.5 rounded-full ${hasPart ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                            {item.label}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Coach Advice */}
                  <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 space-y-2 mt-auto">
                    <label className="text-[10px] font-black text-blue-400 uppercase tracking-wider block">Live Coach Insight</label>
                    <p className="text-xs text-slate-300 font-semibold leading-relaxed">
                      {latestEval.feedback}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            // Real-Time Report Tab
            <div className="flex-1 flex flex-col justify-start gap-5">
              {evaluationsList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-4 text-slate-500">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-inner">
                    <Sparkles className="w-6 h-6 text-slate-400 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-300 mb-1">No Data Yet</h4>
                    <p className="text-xs text-slate-500 max-w-[220px] mx-auto leading-relaxed">
                      Your live performance metrics will populate here in real-time as soon as you submit your first answer.
                    </p>
                  </div>
                </div>
              ) : (
                (() => {
                  const report = aggregateReport(evaluationsList, history, roleContext, companyContext);
                  return (
                    <div className="space-y-5">
                      {/* Overall Progress Gauge */}
                      <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl border border-white/10">
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                            <circle cx="32" cy="32" r="26" fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray="163" strokeDashoffset={163 - (163 * report.overall_score) / 100} className="transition-all duration-500" />
                          </svg>
                          <span className="text-base font-black text-white">{report.overall_score}</span>
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Overall Score</h4>
                          <p className="text-sm font-bold text-emerald-400 mt-0.5">Live Performance Report</p>
                        </div>
                      </div>

                      {/* Score Metrics Progress Bars */}
                      <div className="space-y-3 bg-white/5 p-4 rounded-2xl border border-white/10">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-white/5 pb-1.5 mb-2">Metrics Summary</h4>
                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                            <span>Content Quality</span>
                            <span className="text-white">{report.scores.content_quality}/100</span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${report.scores.content_quality}%` }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                            <span>Vocal Delivery</span>
                            <span className="text-white">{report.scores.communication}/100</span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${report.scores.communication}%` }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                            <span>STAR Structure Alignment</span>
                            <span className="text-white">{Math.round(report.scores.structure)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${report.scores.structure}%` }} />
                          </div>
                        </div>
                      </div>

                      {/* Strengths & Improvement Lists */}
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Strengths Recognized
                          </h4>
                          <div className="space-y-2">
                            {report.strengths.map((str, idx) => (
                              <div key={idx} className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-[11px] font-medium text-emerald-300 leading-normal">
                                {str}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-[10px] font-black text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" /> Areas to Optimize
                          </h4>
                          <div className="space-y-2">
                            {report.weaknesses.map((weak, idx) => (
                              <div key={idx} className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/10 text-[11px] font-medium text-red-300 leading-normal">
                                {weak}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          )}
          <div ref={panelBottomRef} />
        </div>
      </div>

      {/* Subtitles & Status Overlay */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 flex justify-center z-50 pointer-events-none">
        <AnimatePresence mode="wait">
          {isAiThinking && !activeSpeakerId && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-amber-500/20 text-amber-500 backdrop-blur-md px-6 py-2 rounded-full border border-amber-500/30 font-bold flex items-center gap-3 shadow-lg"
            >
              <div className="flex gap-1">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
              Processing Answer...
            </motion.div>
          )}
          {!isAiThinking && micActive && !activeSpeakerId && (
            <motion.div
              key="listening"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col gap-2 bg-emerald-500/20 backdrop-blur-md px-6 py-3 rounded-2xl border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.25)] min-w-[240px]"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400 font-bold text-sm">Listening to you...</span>
                </div>
                <div className="flex items-end gap-1 h-3 pb-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <motion.div
                      key={i}
                      className="w-0.75 bg-emerald-400 rounded-full"
                      animate={{
                        height: ["20%", "90%", "20%"],
                      }}
                      transition={{
                        repeat: Infinity,
                        duration: 0.6,
                        delay: i * 0.1,
                        ease: "easeInOut",
                      }}
                      style={{ height: "20%" }}
                    />
                  ))}
                </div>
              </div>
              {transcript.trim().length > 0 && (
                <div className="space-y-1 mt-1 border-t border-emerald-500/10 pt-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex justify-between text-[9px] text-emerald-400/80 font-extrabold uppercase tracking-wider">
                    <span>Auto-submitting in {(silenceProgress / 100 * pauseThreshold).toFixed(1)}s</span>
                    <span>{Math.round(silenceProgress)}%</span>
                  </div>
                  <div className="h-1 w-full bg-emerald-950/50 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-400 transition-all duration-100 ease-linear rounded-full"
                      style={{ width: `${silenceProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-32 left-0 right-0 px-8 z-40 flex flex-col items-center pointer-events-none">
          <AnimatePresence mode="wait">
            {showCaptions && activeSpeakerId && (
              <motion.div
                key="aispeaking"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-black/80 backdrop-blur-xl border border-blue-500/30 rounded-2xl p-6 max-w-4xl w-full text-center shadow-[0_0_30px_rgba(59,130,246,0.15)]"
              >
                <p className="text-blue-400 font-bold mb-2 uppercase tracking-widest text-xs flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  {selectedPersonas.find((p) => p.id === activeSpeakerId)?.name}{" "}
                  is speaking
                </p>
                <p className="text-2xl font-medium text-white leading-relaxed">
                  {history[history.length - 1]?.content}
                </p>
              </motion.div>
            )}
            {showCaptions && transcript && micActive && !activeSpeakerId && !isAiThinking && (
              <motion.div
                key="userspeaking"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="bg-emerald-900/80 backdrop-blur-xl border border-emerald-500/30 rounded-2xl p-6 max-w-4xl w-full text-center shadow-2xl"
              >
                <p className="text-emerald-400 font-bold mb-2 uppercase tracking-widest text-xs flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live Transcript
                </p>
                <p className="text-xl font-medium text-slate-100 leading-relaxed">
                  "{transcript}"
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-slate-900 border border-slate-700/50 rounded-3xl p-6 max-w-md w-full shadow-2xl relative"
            >
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <Settings className="w-6 h-6 text-blue-400" />
                <h2 className="text-xl font-bold text-white">
                  Interview Settings
                </h2>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Mic className="w-4 h-4 text-emerald-400" /> Microphone
                  </label>
                  <select
                    value={selectedMic}
                    onChange={(e) => setSelectedMic(e.target.value)}
                    className="w-full bg-slate-800 border-slate-700 text-white text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 p-3"
                  >
                    {devices
                      .filter((d) => d.kind === "audioinput")
                      .map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label ||
                            `Microphone ${device.deviceId.slice(0, 5)}...`}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <Video className="w-4 h-4 text-purple-400" /> Camera
                  </label>
                  <select
                    value={selectedCam}
                    onChange={(e) => setSelectedCam(e.target.value)}
                    className="w-full bg-slate-800 border-slate-700 text-white text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 p-3"
                  >
                    {devices
                      .filter((d) => d.kind === "videoinput")
                      .map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label ||
                            `Camera ${device.deviceId.slice(0, 5)}...`}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-slate-300">
                      AI Speech Speed
                    </label>
                    <span className="text-xs font-bold bg-blue-500/20 text-blue-400 px-2 py-1 rounded-md">
                      {aiSpeed}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.7"
                    max="1.5"
                    step="0.1"
                    value={aiSpeed}
                    onChange={(e) => setAiSpeed(parseFloat(e.target.value))}
                    className="w-full accent-blue-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Slower</span>
                    <span>Faster</span>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-800">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-slate-300">
                      Silence Auto-Submit Threshold
                    </label>
                    <span className="text-xs font-bold bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-md">
                      {pauseThreshold}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="5.0"
                    step="0.5"
                    value={pauseThreshold}
                    onChange={(e) => setPauseThreshold(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Fast (1.0s)</span>
                    <span>Slow (5.0s)</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                  <div className="flex items-center gap-2">
                    <Subtitles className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-slate-300">
                      Show Closed Captions (CC)
                    </span>
                  </div>
                  <button
                    onClick={() => setShowCaptions(!showCaptions)}
                    type="button"
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      showCaptions ? "bg-blue-600" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        showCaptions ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-full mt-8 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all"
              >
                Apply & Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
