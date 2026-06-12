'use client';

import { useState, useEffect, createContext, useContext } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Trash } from "lucide-react"
import harper_logo from './harper_logo.png'
import { getUserTraits, updateUserTraits } from '@/app/actions';

export const ControlPanelContext = createContext({
  aiPersonalizationEnabled: true,
  setAiPersonalizationEnabled: () => {},
});

export function ControlPanelProvider({ children }) {
  const [aiPersonalizationEnabled, setAiPersonalizationEnabled] = useState(true);
  return (
    <ControlPanelContext.Provider value={{ aiPersonalizationEnabled, setAiPersonalizationEnabled }}>
      {children}
    </ControlPanelContext.Provider>
  );
}

export function ControlPanel() {
  const { aiPersonalizationEnabled, setAiPersonalizationEnabled } = useContext(ControlPanelContext);
  const [traits, setTraits] = useState([]);
  const [traitsReady, setTraitsReady] = useState(null);
  const [traitValue, setTraitValue] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setTraitsReady(false);
        const response = await getUserTraits();
        setTraits(response);
        setTraitsReady(true);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    fetchData();
  }, []);

  function handleDeleteTrait(e) {
    const id = e.target.id;
    const arrayIndex = Number(id.split('-')[1]);
    const newTraits = traits.filter((_, i) => i !== arrayIndex);
    updateUserTraits("1", newTraits);
    setTraits(newTraits);
  }

  function handleTextChange(e) {
    setTraitValue(e.target.value);
  }

  function handleAddTrait() {
    updateUserTraits("1", [traitValue, ...traits]);
    setTraitValue('');
    setTraits([traitValue, ...traits]);
  }

  return (
    <Dialog>
      <DialogTrigger>
        <div className="control-panel">
          <Image
            className="control-panel-img"
            src={harper_logo}
            alt='harper logo'
          />
          Admin
        </div>
      </DialogTrigger>
      <DialogPortal>
        <DialogContent>
          <DialogTitle>Application Admin Panel</DialogTitle>
          <DialogDescription>Customize app behavior for demo purposes</DialogDescription>
          <div>
            <h3>Demo Features</h3>
            <div style={{ fontSize: 14, color: 'gray' }}>
              <div>
                <span style={{ paddingRight: 20 }}>OpenAI Product Personalization</span>
                <Switch
                  text={aiPersonalizationEnabled ? 'On' : 'Off'}
                  checked={aiPersonalizationEnabled}
                  onClick={() => setAiPersonalizationEnabled(!aiPersonalizationEnabled)}
                />
              </div>
            </div>
          </div>
          <>
            <h3>Current Traits</h3>
            {aiPersonalizationEnabled ? (
              <>
                <div style={{ fontSize: 14, color: 'gray' }}>
                  [
                  {traitsReady && traits ? traits.map((trait, i) => (
                    <span key={`trait-${i}-${trait}`}>
                      {trait}
                      <Button
                        size="sm"
                        variant="ghost"
                        id={`btntraitid-${i}`}
                        onClick={handleDeleteTrait}
                      >
                        <Trash className="h-3 w-3" color="red" id={`icntraitid-${i}`} />
                      </Button>
                      {i === traits.length - 1 ? '' : ', '}
                    </span>
                  )) : 'Loading'}
                  ]
                </div>
                <Input onChange={handleTextChange} value={traitValue} />
                <Button size="lg" variant="default" style={{ backgroundColor: '#262626' }} onClick={handleAddTrait}>
                  Add Trait
                </Button>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'gray', minHeight: 140 }}>
                Featured disabled
              </div>
            )}
          </>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
