import { Copy } from 'lucide-react'
import './index.css'

/**
 * Flexbox版 - SAT Solverによる逆算結果
 *
 * 絶対座標から導出されたFlexbox構造:
 *
 * 水平:
 *   pl-[117px] → gap-[49px] → w-[586px] → gap-[106px] → w-[936px] → pr-[125px]
 *   (stepNum)    (間隔)       (content)    (間隔)        (preview)    (右余白)
 *
 * 垂直ギャップ (bottom → top):
 *   title → step1: 57px (114 → 171)
 *   step1 → step2: 17px (219 → 236)
 *   step2 → step3: 27px (284 → 311, slider top)
 *   slider間: 19px (center-to-center 49px - knob 30px)
 *   step3 → step4: 32px (634 → 666)
 */

function App() {
  const sliders = [
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50px' },
  ]

  return (
    <div className="flex min-h-screen bg-white font-['Geist_Mono']">
      {/* 左カラム: ステップ番号 + コンテンツ */}
      <div className="flex flex-col pt-[66px] pl-[117px] w-[801px]">
        {/* タイトル - 126-117=9px追加パディング */}
        <h1 className="italic text-black text-5xl font-medium leading-none pl-[9px]">
          liquidglass.css
        </h1>

        {/* Step 1 - mt-[57px] = title→step1 gap */}
        <div className="flex items-center mt-[57px]">
          <span className="w-[49px] flex-shrink-0 font-['Inter_Tight'] text-[#b0b0b0] text-sm">
            ①
          </span>
          <div className="bg-[#eee] rounded-xl h-12 w-[586px] flex items-center pl-[23px] text-[13px] relative">
            <span className="text-black">npm i liquidglass.css</span>
            <Copy
              className="absolute text-[#b0b0b0] right-[32px]"
              size={14}
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* Step 2 - mt-[17px] = step1→step2 gap */}
        <div className="flex items-center mt-[17px]">
          <span className="w-[49px] flex-shrink-0 font-['Inter_Tight'] text-[#8f8f8f] text-sm">
            ②
          </span>
          <div className="bg-[#eee] rounded-xl h-12 w-[586px] flex items-center pl-[23px] text-[13px] relative">
            <span className="text-black">import "liquidglass.css"</span>
            <Copy
              className="absolute text-[#8f8f8f] right-[32px]"
              size={14}
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* Step 3 - Sliders - mt-[27px] = step2 bottom (284) → slider top (311) */}
        <div className="flex mt-[27px]">
          {/* ③ is at left:121 (4px more than 117), top:314 (3px below container top 311) */}
          <span className="w-[49px] flex-shrink-0 font-['Inter_Tight'] text-[#a1a1a1] text-sm pt-[3px] pl-[4px]">
            ③
          </span>
          {/*
            Slider geometry (SAT solver derived):
            1px offset + 275px line + 3px gap + 30px knob + 2px gap + 275px line = 586px
          */}
          <div className="flex flex-col gap-[19px] w-[586px] pl-px">
            {sliders.map((s, i) => (
              <div key={i} className="flex items-center">
                {/* 左ライン: 275px */}
                <div className="h-1.5 bg-[#d9d9d9] w-[275px]" />
                {/* gap: 3px */}
                <div className="w-[3px]" />
                {/* ノブ: 30px */}
                <div className="w-[30px] h-[30px] bg-black rounded-full text-white text-[13px] flex items-center justify-center flex-shrink-0">
                  {s.value}
                </div>
                {/* gap: 2px */}
                <div className="w-[2px]" />
                {/* 右ライン: 275px */}
                <div className="h-1.5 bg-[#d9d9d9] w-[275px]" />
              </div>
            ))}
          </div>
        </div>

        {/* Step 4 - mt-[31px] = adjusted for 1px cumulative gap variance */}
        <div className="flex mt-[31px]">
          {/* ④ is at top:682, step4 container at 666, so pt = 682-666 = 16px */}
          <span className="w-[49px] flex-shrink-0 font-['Inter_Tight'] text-[#858585] text-sm pt-[16px]">
            ④
          </span>
          <div className="bg-[#eee] rounded-2xl w-[586px] h-[264px] pt-[23px] pr-10 pb-3 pl-[23px] text-[13px] leading-[1.35] relative">
            <pre className="whitespace-pre text-black">{`div {
  --liquidglass-refraction:    50;
  --liquidglass-thickness:     50;
  --liquidglass-softness:      50;
  --liquidglass-gloss:         50;
  --liquidglass-saturation:    50;
  --liquidglass-dispersion:    50;

  border-radius:               50px;
}`}</pre>
            <Copy
              className="absolute text-[#858585] right-[32px] top-[23px]"
              size={14}
              strokeWidth={1.5}
            />
          </div>
        </div>
      </div>

      {/* 右カラム: プレビュー */}
      <div className="flex-1 pt-[60px] pl-[106px] pr-[125px]">
        <div className="bg-black rounded-[76px] w-[936px] h-[873px]" />
      </div>
    </div>
  )
}

export default App
