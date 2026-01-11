-- +migrate Up
CREATE TABLE public.stripe_products (
    id VARCHAR(100) PRIMARY KEY,
    stripe_product_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Add stripe_product_id foreign key to billing_plans
ALTER TABLE public.billing_plans
ADD COLUMN stripe_product_id VARCHAR(100) REFERENCES public.stripe_products(stripe_product_id);

-- Create indexes
CREATE INDEX idx_stripe_products_stripe_product_id ON public.stripe_products(stripe_product_id);
CREATE INDEX idx_billing_plans_stripe_product_id ON public.billing_plans(stripe_product_id);
