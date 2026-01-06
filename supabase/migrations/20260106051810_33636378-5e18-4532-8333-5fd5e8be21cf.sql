-- Create availability_hours table to store user's available hours for scheduling
CREATE TABLE public.availability_hours (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0 = Sunday, 6 = Saturday
    start_time TIME NOT NULL DEFAULT '09:00:00',
    end_time TIME NOT NULL DEFAULT '17:00:00',
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (connection_id, day_of_week)
);

-- Enable Row Level Security
ALTER TABLE public.availability_hours ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own availability" 
ON public.availability_hours 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own availability" 
ON public.availability_hours 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own availability" 
ON public.availability_hours 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own availability" 
ON public.availability_hours 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_availability_hours_updated_at
BEFORE UPDATE ON public.availability_hours
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();