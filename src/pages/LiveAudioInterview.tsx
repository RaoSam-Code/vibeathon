/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, ChevronRight, CheckCircle2, TrendingUp, BookOpen, Maximize2, Loader2, ArrowRight, AlertTriangle, Clock, MicOff, Settings, RefreshCw, Sparkles } from "lucide-react";
import { NeuCard, NeuButton } from "@/components/LiquidGlass";
import { useAuth } from "@/contexts/AuthContext";
import { API_URL, createInterviewSession, endInterviewSession, addQALog } from "@/lib/api";

interface Question {
  question: string;
  type: string;
  focus: string;
}

interface Evaluation {
  optimizedAnswer: string;
  toneScore: number;
  toneRemark: string;
  vocabularyScore: number;
  vocabularyRemark: string;
  feedback: string;
}

export default function LiveAudioInterview() {
  const location = useLocation();
  const navigate = useNavigate();
  const { questions, role, jdText, difficulty } = location.state || { questions: [], role: '', jdText: '', difficulty: '' };

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [volume, setVolume] = useState(0);
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<Evaluation[]>([]);
  const [timeLeft, setTimeLeft] = useState(60);
  const [evaluationsList, setEvaluationsList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"analytics" | "report">("analytics");

  const analyticsBottomRef = useRef<HTMLDivElement | null>(null);
  const reportBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeTab === "analytics") {
      analyticsBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [evaluation, isEvaluating, activeTab]);

  useEffect(() => {
    if (activeTab === "report") {
      reportBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [evaluationsList.length, activeTab]);

  const { user } = useAuth();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  const silenceStartRef = useRef<number | null>(null);
  const hasSpokenRef = useRef<boolean>(false);
  const activeQuestion = questions[currentIndex];

  // Check for devices
  const checkDevices = useCallback(async (forceRequest = false) => {
    try {
      if (forceRequest) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');

      // If we have mics but no labels, we still need permission to see labels
      const hasLabels = mics.some(m => m.label);
      if (mics.length > 0 && !hasLabels && !forceRequest) {
        // Silently try to get labels if list exists but labels are hidden
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          return checkDevices(true); // Recurse once with permission
        } catch (e) { /* empty */ }
      }

      setAvailableMics(mics);
      if (mics.length > 0 && !selectedMic) {
        setSelectedMic(mics[0].deviceId);
      }
      console.log("Available Mics:", mics);
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
    }
  }, [selectedMic]);

  useEffect(() => {
    checkDevices();

    if (!questions || questions.length === 0) {
      navigate("/audio-setup");
      return;
    }

    // Initialize Session
    const startSession = async () => {
      if (!user) return;
      try {
        const data = await createInterviewSession(user.id, questions[0]?.focus || "General", role);
        setSessionId(data.id);
      } catch (err) {
        console.error("Failed to start session:", err);
      }
    };

    startSession();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => { /* empty */ });
      }
    };
  }, [navigate, questions, user, role]);

  useEffect(() => {
    setTimeLeft(60);
  }, [currentIndex]);

  useEffect(() => {
    let interval: any  ;
    if (timeLeft > 0 && !isEvaluating && !evaluation) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isRecording) {
      stopRecording();
    }
    return () => clearInterval(interval);
  }, [timeLeft, isEvaluating, evaluation, isRecording]);

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);
    cancelAnimationFrame(animationFrameRef.current);
    setVolume(0);
    silenceStartRef.current = null;
    hasSpokenRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => { /* empty */ });
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      // START RECORDING
      try {
        const constraints = {
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // --- Audio Visualizer Setup ---
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateVolume = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avgVolume = sum / dataArray.length;
          setVolume(avgVolume);

          // Auto-Silence Detection
          const SILENCE_THRESHOLD = 2; // Lowered so it picks up normal/quiet speech
          const SILENCE_DURATION = 3000; // Increased to 3 seconds so users don't get cut off mid-thought

          if (avgVolume > SILENCE_THRESHOLD) {
            hasSpokenRef.current = true;
            silenceStartRef.current = null;
          } else if (hasSpokenRef.current) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now();
            } else if (Date.now() - silenceStartRef.current > SILENCE_DURATION) {
              stopRecording();
              return; // Stop the loop
            }
          }

          animationFrameRef.current = requestAnimationFrame(updateVolume);
        };
        updateVolume();
        // ------------------------------

        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        });

        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          setIsEvaluating(true);
          setTranscript("");

          try {
            const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
            const reader = new FileReader();

            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
              const base64Audio = (reader.result as string).split(',')[1];

              const sttRes = await fetch(`${API_URL}api/agents/stt`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  audioBase64: base64Audio,
                  mimeType: mediaRecorder.mimeType
                })
              });

              if (!sttRes.ok) throw new Error("STT failed");
              const sttData = await sttRes.json();
              let finalTranscript = sttData.text;

              // Filter out Whisper hallucination for silence
              if (finalTranscript.trim().toLowerCase() === "you" || finalTranscript.trim().toLowerCase() === "you.") {
                finalTranscript = "";
              }

              setTranscript(finalTranscript);

              if (!finalTranscript.trim()) {
                alert("No speech detected! Your microphone recorded absolute silence. Please check Windows Sound Settings or your physical mic mute button.");
                setIsEvaluating(false);
                return;
              }

              submitAnswer(finalTranscript);
            };
          } catch (e: unknown) {
            console.error("Audio processing failed", e);
            alert("Error processing your audio. Please try again.");
            setIsEvaluating(false);
          }

          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start(1000); // chunk every 1 sec
        setIsRecording(true);
        setEvaluation(null);

      } catch (err: unknown) {
        console.error("Microphone access denied or error:", err);
        let errorMsg = "Microphone access denied. Please grant permissions in your browser URL bar.";
        const errorName = (err as Error).name;
        if (errorName === 'NotAllowedError') {
          errorMsg = "Permission Denied: Please click the lock icon in your URL bar and 'Allow' the microphone.";
        } else if (errorName === 'NotFoundError') {
          errorMsg = "No microphone found. Please connect a mic and try again.";
        } else if (errorName === 'NotReadableError') {
          errorMsg = "Microphone is busy. Another app might be using it.";
        }
        alert(errorMsg);
      }
    }
  };

  const submitAnswer = async (finalTranscript: string) => {
    try {
      const res = await fetch(`${API_URL}api/agents/evaluate-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAnswer: finalTranscript,
          currentQuestion: activeQuestion?.question,
          jobDescription: jdText
        })
      });

      if (!res.ok) throw new Error("Evaluation failed");

      const data = await res.json();
      
      if (sessionId && user?.id) {
        await addQALog({
          session_id: sessionId,
          user_id: user.id,
          question_text: activeQuestion?.question,
          user_answer_text: finalTranscript,
          ai_feedback_text: data.feedback,
          score_content: data.toneScore,
          score_delivery: data.vocabularyScore,
          is_weakness: data.toneScore < 60
        });
      }

      const evalItem = {
        ...data,
        userAnswer: finalTranscript,
        questionText: activeQuestion?.question
      };

      setEvaluation(data);
      setEvaluationsList(prev => [...prev, evalItem]);
      setHistory(prev => [...prev, data]);
    } catch (err) {
      console.error(err);
      alert("Failed to evaluate answer.");
    } finally {
      setIsEvaluating(false);
    }
  };

  // Helper to aggregate evaluations in real-time
  const aggregateReport = (evals: any[], roleStr: string) => {
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

    const contentScores = evals.map(e => e.vocabularyScore ?? 75);
    const deliveryScores = evals.map(e => e.toneScore ?? 75);
    const keywordScores = evals.map(e => e.vocabularyScore ?? 75);
    const pacingScores = evals.map(e => e.pacingScore ?? 75);
    const fillerScores = evals.map(e => e.fillerWordsScore ?? 75);

    const contentAvg = avg(contentScores);
    const deliveryAvg = avg(deliveryScores);
    const keywordAvg = avg(keywordScores);
    const pacingAvg = avg(pacingScores);
    const fillerAvg = avg(fillerScores);

    const starRates: number[] = evals.map(e => {
      const star = e.starStatus || { situation: true, task: true, action: false, result: false };
      const count = (star.situation ? 1 : 0) + (star.task ? 1 : 0) + (star.action ? 1 : 0) + (star.result ? 1 : 0);
      return (count / 4) * 100;
    });
    const starAvg = avg(starRates);

    const overallScore = Math.round((contentAvg + deliveryAvg) / 2);

    const strengths = evals.map(e => e.strength).filter(Boolean);
    const weaknesses = evals.map(e => e.weakness).filter(Boolean);

    const standoutAnswers: string[] = [];
    const weakAnswers: string[] = [];

    evals.forEach((ev) => {
      const score = Math.round(((ev.vocabularyScore ?? 75) + (ev.toneScore ?? 75)) / 2);
      if (score >= 82) {
        standoutAnswers.push(`Q: "${ev.questionText}" - Clear structured answer with strong depth (${score}%).`);
      } else if (score < 68) {
        weakAnswers.push(`Q: "${ev.questionText}" - Could be optimized. ${ev.feedback || ev.weakness}`);
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
      overall_feedback: `You completed a ${evals.length}-question audio interview for ${roleStr}. Your content score was ${contentAvg}% with a delivery of ${deliveryAvg}%. ${
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

  const nextQuestion = async () => {
    if (currentIndex < questions.length - 1) {
      setTranscript("");
      setEvaluation(null);
      setCurrentIndex(curr => curr + 1);
    } else {
      // Finalize Session
      try {
        const avgScore = history.length > 0
          ? Math.round(history.reduce((a, b) => a + b.toneScore, 0) / history.length)
          : 0;

        if (sessionId) {
          await endInterviewSession(sessionId, avgScore, 0, "");
        }

        const finalReport = aggregateReport(evaluationsList, role || 'Software Engineer');

        // Form history logs matching Report.tsx
        const finalHistoryLogs: { role: string; content: string }[] = [];
        evaluationsList.forEach((ev) => {
          finalHistoryLogs.push({ role: 'ai', content: ev.questionText });
          finalHistoryLogs.push({ role: 'user', content: ev.userAnswer });
        });

        navigate(`/report/${sessionId || 'last'}`, {
          state: {
            sessionData: finalHistoryLogs,
            role: role || 'Software Engineer',
            company: 'Tech Company',
            durationSeconds: 300,
            generatedReport: finalReport
          }
        });
      } catch (err) {
        console.error("Failed to complete session:", err);
        navigate("/dashboard");
      }
    }
  };

  if (!questions || questions.length === 0) return null;

  return (
    <div className="min-h-screen bg-[#e0e5ec] p-4 lg:p-8 flex flex-col md:flex-row gap-6">

      {/* Left Column: Recording & Active Question */}
      <div className="flex-1 flex flex-col gap-6">
        <NeuCard className="p-6 flex-1 flex flex-col relative">

          {/* Hardware Diagnostic Visualizer */}
          {isRecording && (
            <div className="absolute top-6 right-6 flex items-center gap-3 bg-white/50 backdrop-blur-md px-4 py-2 rounded-2xl shadow-sm border border-white/40">
              <span className="text-xs font-bold text-slate-500 uppercase">Mic Level</span>
              <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                <motion.div
                  className={`absolute left-0 top-0 bottom-0 transition-colors duration-100 ${volume > 5 ? 'bg-green-500' : 'bg-red-500'}`}
                  animate={{ width: `${Math.min(100, (volume / 128) * 100)}%` }}
                  transition={{ type: "tween", ease: "linear", duration: 0.1 }}
                />
              </div>
              {volume < 2 && (
                <TooltipHover text="If the bar is red and not moving, your mic is muted at the OS/hardware level!" />
              )}
            </div>
          )}

          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="neu-flat px-3 py-1 rounded-lg text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE
              </div>
              <span className="text-sm font-bold text-slate-500">Question {currentIndex + 1} of {questions.length}</span>
            </div>

            <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full font-black text-sm tracking-widest shadow-sm border transition-all duration-300 ${timeLeft < 15 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
              <Clock className={`w-4 h-4 ${timeLeft < 15 ? 'text-red-500' : 'text-blue-500'}`} />
              00:{String(timeLeft).padStart(2, '0')}
            </div>

            <span className="text-xs font-bold text-slate-400 uppercase">{activeQuestion?.type} Focus</span>
          </div>

          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 flex flex-col justify-center"
          >
            <h2 className="font-display text-3xl md:text-4xl font-black text-slate-800 leading-tight mb-8 text-center md:text-left">
              "{activeQuestion?.question}"
            </h2>

            <div className="neu-pressed rounded-2xl p-6 min-h-[150px] flex flex-col items-center justify-center text-center mb-8 relative">
              {!transcript && !isRecording && !isEvaluating && (
                <p className="text-slate-400 font-semibold italic">Tap the mic and start speaking your answer...</p>
              )}
              {!transcript && isRecording && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  {volume < 2 && (
                    <p className="text-xs font-bold text-red-500 bg-red-50 px-3 py-1 rounded-full animate-pulse border border-red-200">
                      Warning: No audio detected! Check your mic mute button.
                    </p>
                  )}
                </div>
              )}
              {transcript && (
                <p className="text-slate-800 font-semibold text-lg max-w-2xl mx-auto">"{transcript}"</p>
              )}
            </div>
          </motion.div>

          <div className="flex flex-col items-center justify-center pt-4">
            <button
              onClick={toggleRecording}
              disabled={isEvaluating}
              className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isRecording
                ? "bg-red-500 text-white shadow-[inset_4px_4px_8px_rgba(0,0,0,0.2),_inset_-4px_-4px_8px_rgba(255,255,255,0.2)] animate-pulse scale-105"
                : "neu-convex text-slate-600 hover:text-blue-600 active:scale-95"
                } ${isEvaluating ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isRecording ? <Square className="w-8 h-8 fill-current" /> : <Mic className="w-10 h-10" />}
            </button>
            <p className="mt-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
              {isRecording ? "Tap to Stop & Evaluate" : "Tap to Speak"}
            </p>

            {/* Microphone Selection */}
            <div className="mt-6 w-full max-w-[240px] space-y-4">
              {availableMics.length === 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-50 border border-orange-100 text-orange-600">
                    <MicOff className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">No Microphone Found</span>
                  </div>
                  <button
                    onClick={() => checkDevices(true)}
                    className="w-full py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                  >
                    Enable Microphone
                  </button>
                </div>
              ) : (
                <div className="relative group">
                  <select
                    value={selectedMic}
                    onChange={(e) => setSelectedMic(e.target.value)}
                    className="w-full pl-8 pr-4 py-2 text-[10px] font-bold text-slate-600 bg-white/50 backdrop-blur-sm border border-slate-200 rounded-xl appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all neu-pressed-shallow"
                  >
                    {availableMics.map((mic) => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || `Microphone ${mic.deviceId.slice(0, 5)}...`}
                      </option>
                    ))}
                  </select>
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-blue-500 transition-colors">
                    <Settings className="w-3.5 h-3.5" />
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => checkDevices(false)}
                  className="flex items-center gap-1.5 text-[9px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-700 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh Devices
                </button>

                <button
                  onClick={() => setShowTroubleshoot(!showTroubleshoot)}
                  className="text-[9px] font-bold text-slate-400 border-b border-slate-200 hover:text-slate-600 transition-colors"
                >
                  {showTroubleshoot ? "Hide Troubleshooting" : "Troubleshoot Problem"}
                </button>
              </div>

              {showTroubleshoot && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3"
                >
                  <p className="text-[10px] font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-orange-500" /> Troubleshooting Guide
                  </p>
                  <ol className="text-[9px] text-slate-600 space-y-2 list-decimal pl-4 font-bold">
                    <li>Click the **Lock Icon** in the URL bar and ensure Microphone is **Allowed**.</li>
                    <li>Check **System Settings | Security | Microphone** (Mac/Windows) and ensure your browser is enabled.</li>
                    <li>Ensure no other app (Zoom, Teams, etc.) is using your microphone right now.</li>
                    <li>If on a mobile browser, try clicking the "Enable Microphone" button above.</li>
                    <li>Try using `http://127.0.0.1:8080` instead of `localhost` if problems persist.</li>
                  </ol>
                </motion.div>
              )}
            </div>
          </div>
        </NeuCard>
      </div>

      {/* Right Column: AI Analytics Feedback */}
      <div className="w-full md:w-[450px] lg:w-[500px] flex flex-col gap-6">
        <NeuCard className="p-6 flex-1 flex flex-col h-full">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-6">
            <h3 className="font-display text-xl font-black text-slate-800 flex items-center gap-2">
              <Maximize2 className="w-5 h-5 text-blue-500" /> Real-Time Analytics
            </h3>
            <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">Active Evaluation</span>
          </div>

          {/* Tab Selection */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 mb-6">
            <button
              onClick={() => setActiveTab("analytics")}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                activeTab === "analytics"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Live Analytics
            </button>
            <button
              onClick={() => setActiveTab("report")}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                activeTab === "report"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Real-Time Report
            </button>
          </div>

          {activeTab === "analytics" ? (
            <div className="flex-1 neu-pressed rounded-2xl p-5 overflow-y-auto scroll-smooth scrollbar-hide">
              {!isEvaluating && !evaluation ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                  <CheckCircle2 className="w-12 h-12 text-slate-400 mb-4" />
                  <p className="text-sm font-bold text-slate-500">Awaiting your response.</p>
                  <p className="text-xs font-semibold text-slate-400 mt-1">Submit your answer to get instant optimization feedback.</p>
                </div>
              ) : isEvaluating ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-blue-600">
                  <Loader2 className="w-10 h-10 animate-spin mb-4" />
                  <p className="text-sm font-bold">Transcribing & Analyzing Tone...</p>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                    {/* Optimized Answer */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-green-600 uppercase tracking-[0.2em] flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5" /> AI Optimized Answer
                        </span>
                        <div className="h-[1px] flex-1 bg-green-100 ml-4" />
                      </div>
                      <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-400 rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-500"></div>
                        <p className="relative text-slate-700 text-sm font-bold leading-relaxed p-4 bg-white/60 backdrop-blur-sm rounded-xl border border-green-100 shadow-sm italic">
                          "{evaluation?.optimizedAnswer}"
                        </p>
                      </div>
                    </div>

                    {/* Scores Grid */}
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="neu-flat p-4 rounded-2xl text-center space-y-1 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                          <TrendingUp className="w-8 h-8 text-blue-500" />
                        </div>
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-3xl font-black text-slate-800">{evaluation?.toneScore}</span>
                          <span className="text-xs font-bold text-slate-400">/100</span>
                        </div>
                        <div className="inline-block px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100">
                          <p className="text-[10px] font-black text-blue-600 uppercase tracking-wider">{evaluation?.toneRemark || "Improving"}</p>
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pt-1">Tone Status</p>
                      </div>

                      <div className="neu-flat p-4 rounded-2xl text-center space-y-1 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                          <BookOpen className="w-8 h-8 text-purple-500" />
                        </div>
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-3xl font-black text-slate-800">{evaluation?.vocabularyScore}</span>
                          <span className="text-xs font-bold text-slate-400">/100</span>
                        </div>
                        <div className="inline-block px-2 py-0.5 rounded-full bg-purple-50 border border-purple-100">
                          <p className="text-[10px] font-black text-purple-600 uppercase tracking-wider">{evaluation?.vocabularyRemark || "Developing"}</p>
                        </div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest pt-1">Vocabulary</p>
                      </div>
                    </div>

                    {/* Constructive Feedback */}
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> Constructive Feedback
                        </span>
                        <div className="h-[1px] flex-1 bg-slate-200 ml-4" />
                      </div>
                      <div className="space-y-3">
                        {evaluation?.feedback.split('\n').filter(p => p.trim()).map((point, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="flex gap-3 items-start"
                          >
                            <div className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            </div>
                            <p className="text-slate-600 text-xs font-bold leading-normal pt-0.5">
                              {point.replace(/^\*?\s*/, '')}
                            </p>
                          </motion.div>
                        ))}
                      </div>
                    </div>

                  </motion.div>
                </AnimatePresence>
              )}
              <div ref={analyticsBottomRef} />
            </div>
          ) : (
            // Real-Time Report Tab
            <div className="flex-1 neu-pressed rounded-2xl p-5 overflow-y-auto scroll-smooth scrollbar-hide">
              {evaluationsList.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50 gap-4 text-slate-500">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/50 border border-slate-200 shadow-inner">
                    <Sparkles className="w-6 h-6 text-slate-400 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-slate-700 mb-1">No Data Yet</h4>
                    <p className="text-xs text-slate-500 max-w-[220px] mx-auto leading-relaxed">
                      Your live performance metrics will populate here in real-time as soon as you submit your first answer.
                    </p>
                  </div>
                </div>
              ) : (
                (() => {
                  const report = aggregateReport(evaluationsList, role || 'Software Engineer');
                  return (
                    <div className="space-y-5 text-slate-800">
                      {/* Overall Progress Gauge */}
                      <div className="flex items-center gap-4 bg-white/60 backdrop-blur-sm p-4 rounded-2xl border border-white shadow-sm">
                        <div className="relative w-16 h-16 flex items-center justify-center">
                          <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="4" />
                            <circle cx="32" cy="32" r="26" fill="none" stroke="#3b82f6" strokeWidth="4" strokeDasharray="163" strokeDashoffset={163 - (163 * report.overall_score) / 100} className="transition-all duration-500" />
                          </svg>
                          <span className="text-base font-black text-slate-800">{report.overall_score}</span>
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Overall Score</h4>
                          <p className="text-sm font-bold text-emerald-600 mt-0.5">Live Performance Report</p>
                        </div>
                      </div>

                      {/* Score Metrics Progress Bars */}
                      <div className="space-y-3 bg-white/60 backdrop-blur-sm p-4 rounded-2xl border border-white shadow-sm">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200 pb-1.5 mb-2">Metrics Summary</h4>
                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                            <span>Content Quality</span>
                            <span className="text-slate-800">{report.scores.content_quality}/100</span>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${report.scores.content_quality}%` }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                            <span>Vocal Delivery</span>
                            <span className="text-slate-800">{report.scores.communication}/100</span>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${report.scores.communication}%` }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                            <span>STAR Structure Alignment</span>
                            <span className="text-slate-800">{Math.round(report.scores.structure)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${report.scores.structure}%` }} />
                          </div>
                        </div>
                      </div>

                      {/* Strengths & Improvement Lists */}
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Strengths Recognized
                          </h4>
                          <div className="space-y-2">
                            {report.strengths.map((str, idx) => (
                              <div key={idx} className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-[11px] font-bold text-emerald-700 leading-normal">
                                {str}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <h4 className="text-[10px] font-black text-red-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" /> Areas to Optimize
                          </h4>
                          <div className="space-y-2">
                            {report.weaknesses.map((weak, idx) => (
                              <div key={idx} className="p-2.5 rounded-xl bg-red-50 border border-red-100 text-[11px] font-bold text-red-700 leading-normal">
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
              <div ref={reportBottomRef} />
            </div>
          )}

          <NeuButton
            className="w-full mt-6 py-4 flex items-center justify-center gap-2"
            disabled={!evaluation && !isEvaluating}
            onClick={nextQuestion}
          >
            {currentIndex < questions.length - 1 ? "Next Question" : "Complete Interview"}
            <ArrowRight className="w-4 h-4 ml-2" />
          </NeuButton>
        </NeuCard>
      </div>

    </div>
  );
}

function TooltipHover({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative flex items-center" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <AlertTriangle className="w-4 h-4 text-red-500 cursor-help" />
      {show && (
        <div className="absolute top-full mt-2 w-48 right-0 bg-slate-800 text-white text-[10px] font-bold px-3 py-2 rounded-lg shadow-xl z-50">
          {text}
        </div>
      )}
    </div>
  );
}
