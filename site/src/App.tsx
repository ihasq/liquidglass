import { Copy } from 'lucide-react'
import './index.css'

function App() {
  // Slider: gray line 167-444, knob 445-474, gray line 477-519
  // 9 parameters with 42px spacing
  const sliderRows = [
    { y: 325, value: '50' },    // refraction
    { y: 367, value: '50' },    // thickness
    { y: 409, value: '50' },    // softness
    { y: 451, value: '50' },    // gloss
    { y: 493, value: '50' },    // saturation
    { y: 535, value: '50' },    // dispersion
    { y: 577, value: '45' },    // displacement-resolution (new)
    { y: 619, value: '30' },    // displacement-smoothing (new)
    { y: 661, value: '50px' },  // border-radius
  ];

  return (
    <div className="relative w-[1919px] h-[997px] bg-white font-['Geist_Mono'] overflow-hidden">
      {/* Title - #000, medium weight (500) */}
      <div
        className="absolute italic text-[#000]"
        style={{ left: 126, top: 66, fontSize: 48, lineHeight: 1.0, fontWeight: 500 }}
      >
        liquidglass.css
      </div>

      {/* Step 1 - all code blocks right-aligned to x=752 */}
      <span
        className="absolute font-['Inter_Tight'] text-[#b0b0b0]"
        style={{ left: 117, top: 184, fontSize: 14 }}
      >①</span>
      <div
        className="absolute bg-[#eee] flex items-center rounded-[12px]"
        style={{ left: 166, top: 171, width: 586, height: 48, paddingLeft: 23, fontSize: 13 }}
      >
        <span className="text-[#000]">npm i liquidglass.css</span>
      </div>
      <Copy className="absolute text-[#b0b0b0]" style={{ left: 720, top: 187 }} size={14} strokeWidth={1.5} />

      {/* Step 2 - same width as step 1 */}
      <span
        className="absolute font-['Inter_Tight'] text-[#8f8f8f]"
        style={{ left: 117, top: 250, fontSize: 14 }}
      >②</span>
      <div
        className="absolute bg-[#eee] flex items-center rounded-[12px]"
        style={{ left: 166, top: 236, width: 586, height: 48, paddingLeft: 23, fontSize: 13 }}
      >
        <span className="text-[#000]">import "liquidglass.css"</span>
      </div>
      <Copy className="absolute text-[#8f8f8f]" style={{ left: 720, top: 252 }} size={14} strokeWidth={1.5} />

      {/* Step 3 - ③ at roughly (133, 320) */}
      <span
        className="absolute font-['Inter_Tight'] text-[#a1a1a1]"
        style={{ left: 121, top: 314, fontSize: 14 }}
      >③</span>

      {/* Slider rows */}
      {sliderRows.map((row, i) => (
        <div key={i}>
          {/* Left gray line: x=167 to x=441 (width=275) */}
          <div
            className="absolute h-[6px] bg-[#d9d9d9]"
            style={{ left: 167, top: row.y - 3, width: 275 }}
          />
          {/* 30x30 circular knob at x=445, y offset -14 */}
          <div
            className="absolute bg-[#000] rounded-full flex items-center justify-center text-[#fff]"
            style={{
              left: 445,
              top: row.y - 14,
              width: 30,
              height: 30,
              fontSize: 13,
            }}
          >
            {row.value}
          </div>
          {/* Right gray line: x=477-752, same end as code blocks */}
          <div
            className="absolute h-[6px] bg-[#d9d9d9]"
            style={{ left: 477, top: row.y - 3, width: 275 }}
          />
        </div>
      ))}

      {/* Step 4 - same right edge as step 1 and 2 */}
      <span
        className="absolute font-['Inter_Tight'] text-[#858585]"
        style={{ left: 117, top: 724, fontSize: 14 }}
      >④</span>
      <div
        className="absolute bg-[#eee] text-[#000] rounded-[16px]"
        style={{ left: 166, top: 708, width: 586, height: 286, padding: '23px 40px 12px 23px', fontSize: 13, lineHeight: 1.35 }}
      >
        <pre className="whitespace-pre">{`div {
  --liquidglass-refraction:              50;
  --liquidglass-thickness:               50;
  --liquidglass-softness:                50;
  --liquidglass-gloss:                   50;
  --liquidglass-saturation:              50;
  --liquidglass-dispersion:              50;
  --liquidglass-displacement-resolution: 45;
  --liquidglass-displacement-smoothing:  30;

  border-radius:                         50px;
}`}</pre>
      </div>
      <Copy className="absolute text-[#858585]" style={{ left: 720, top: 726 }} size={14} strokeWidth={1.5} />

      {/* Black preview box */}
      <div
        className="absolute bg-black"
        style={{
          left: 858,
          top: 60,
          width: 936,
          height: 873,
          borderRadius: 76,
        }}
      />
    </div>
  )
}

export default App
